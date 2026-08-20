const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { historyPlayer, normalizeDisplayText, normalizeIdentifier, assertSettleAllowed } = require('./historyUtils')
//体验trial  //开发板develop
const qrVersion = 'release'

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  // 参数标准化：使用 action/payload 格式
  const { action, payload } = event

  try {
    // 所有带房间 ID 的入口先做统一长度和控制字符检查，避免异常长参数流入查询。
    if (payload && payload.roomId !== undefined) payload.roomId = normalizeIdentifier(payload.roomId, '房间ID', 64)
    if (payload && payload.historyId !== undefined) payload.historyId = normalizeIdentifier(payload.historyId, '战绩ID', 128)
    // 为房间成员换取头像临时链接。
    // 由云函数统一换取，避免客户端受“只能读取自己上传文件”的存储权限影响。
    if (action === 'getAvatarUrls') {
      const { roomId, fileIDs: requestedFileIDs } = payload || {}
      if (!roomId) {
        throw new Error('房间ID不能为空')
      }

      const roomRes = await db.collection('rooms').doc(roomId).get().catch(() => null)
      if (!roomRes || !roomRes.data) {
        throw new Error('房间不存在')
      }

      const players = roomRes.data.players || []
      const requester = players.find(player => player.openid === OPENID && !player.isExited)
      if (!requester) {
        throw new Error('您不在该房间中')
      }

      // 同时包含历史消息中的头像，使已退出玩家的旧消息仍能显示头像。
      const messagesRes = await db.collection('messages').doc(roomId).get().catch(() => ({ data: null }))
      const messageFileIDs = (messagesRes.data?.messages || []).flatMap(message => [
        message.fromAvatarFileID,
        message.toAvatarFileID
      ])
      let fileIDs = [...new Set([
        ...players.map(player => player.avatarFileID),
        ...messageFileIDs
      ].filter(Boolean))]
      if (Array.isArray(requestedFileIDs) && requestedFileIDs.length) {
        const allowed = new Set(fileIDs)
        fileIDs = [...new Set(requestedFileIDs.filter(fileID => allowed.has(fileID)))]
      }
      if (fileIDs.length === 0) {
        return { success: true, avatarUrls: {} }
      }

      const result = await cloud.getTempFileURL({ fileList: fileIDs })
      const avatarUrls = {}
      ;(result.fileList || []).forEach((file, index) => {
        const fileID = file.fileID || file.fileId || fileIDs[index]
        if (fileID && file.tempFileURL) {
          avatarUrls[fileID] = file.tempFileURL
        }
      })

      return { success: true, avatarUrls }
    }

    if (action === 'listHistory') {
      const requestedPage = Number((payload || {}).page)
      const requestedSize = Number((payload || {}).pageSize)
      const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
      const pageSize = Number.isInteger(requestedSize) && requestedSize > 0 ? Math.min(requestedSize, 50) : 20
      const result = await db.collection('history')
        .where({ schemaVersion: 2, participantOpenids: _.all([OPENID]) })
        .orderBy('endTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize + 1)
        .get()
      const docs = result.data || []
      const hasMore = docs.length > pageSize
      const items = docs.slice(0, pageSize).map(item => {
        const me = (item.players || []).find(player => player.openid === OPENID) || { score: 0 }
        return {
          historyId: item._id,
          roomId: item.roomId,
          roomName: item.roomName || '未命名牌局',
          mode: item.mode === 'bet' ? 'bet' : 'normal',
          endTime: item.endTime,
          myScore: Number.isSafeInteger(me.score) ? me.score : 0,
          participantCount: (item.players || []).length
        }
      })
      return { success: true, items, page, hasMore }
    }

    if (action === 'getHistoryDetail') {
      const { historyId } = payload || {}
      if (!historyId || typeof historyId !== 'string') throw new Error('战绩ID无效')
      const historyRes = await db.collection('history').doc(historyId).get().catch(() => null)
      const history = historyRes && historyRes.data
      if (!history || history.schemaVersion !== 2) throw new Error('战绩不存在')
      if (!(history.participantOpenids || []).includes(OPENID)) throw new Error('无权查看该战绩')
      const fileIDs = [...new Set((history.players || []).map(player => player.avatarFileID).filter(Boolean))]
      const avatarUrls = {}
      if (fileIDs.length) {
        const urlResult = await cloud.getTempFileURL({ fileList: fileIDs })
        ;(urlResult.fileList || []).forEach((file, index) => {
          const fileID = file.fileID || file.fileId || fileIDs[index]
          if (fileID && file.tempFileURL) avatarUrls[fileID] = file.tempFileURL
        })
      }
      // 旧记录可能带有下注摘要；详情接口不再返回，所有模式只展示最终积分。
      const { betSummary, ...historyDetail } = history
      return { success: true, detail: { ...historyDetail, historyId: history._id, avatarUrls } }
    }

    // 动作 A：加入房间
    if (action === 'join') {
      const roomId = normalizeIdentifier(payload.roomId, '房间ID', 64)
      const nickname = normalizeDisplayText(payload.nickname, '昵称', 10)
      const avatarFileID = payload.avatarFileID ? normalizeIdentifier(payload.avatarFileID, '头像文件', 512) : ''

      const roomRes = await db.collection('rooms').doc(roomId).get().catch(() => null)

      if (!roomRes || !roomRes.data) {
        throw new Error('房间不存在')
      }

      const room = roomRes.data

      if (room.status !== 'active') {
        throw new Error('房间已结束')
      }

      if (room.players.length >= 8) {
        throw new Error('房间人数已满')
      }

      const existingPlayer = room.players.find(p => p.openid === OPENID)

      if (existingPlayer && !existingPlayer.isExited) {
        throw new Error('您已在该房间中')
      }

      // 检查用户是否在其他活跃房间
      const userRes = await db.collection('users').doc(OPENID).get().catch(() => ({ data: null }))
      if (userRes.data && userRes.data.currentRoomId && userRes.data.currentRoomId !== roomId) {
        const otherRoomRes = await db.collection('rooms').doc(userRes.data.currentRoomId).get().catch(() => null)
        if (otherRoomRes && otherRoomRes.data && otherRoomRes.data.status === 'active') {
          throw new Error('您当前已在其他活跃房间中')
        }
      }

      // 临时 URL 不入库；页面始终从永久 fileID 换取可显示的链接。
      const avatarTempUrl = ''

      const transaction = await db.startTransaction()
      try {
        let newPlayers = [...room.players]

        if (existingPlayer) {
          // 重新加入已退出的房间
          const idx = newPlayers.findIndex(p => p.openid === OPENID)
          newPlayers[idx].isExited = false
          newPlayers[idx].nickname = nickname
          // 更新头像信息
          newPlayers[idx].avatar = avatarTempUrl
          newPlayers[idx].avatarFileID = avatarFileID
        } else {
          // 新玩家加入
          newPlayers.push({
            openid: OPENID,
            nickname,
            avatar: avatarTempUrl,           // 临时 URL（2小时内有效）
            avatarFileID,     // fileID（永久，用于重新获取URL）
            score: 0,
            isExited: false
          })
        }

        await transaction.collection('rooms').doc(roomId).update({
          data: { players: newPlayers }
        })

        await transaction.collection('users').doc(OPENID).update({
          data: { currentRoomId: roomId }
        })

        await transaction.commit()

        // 加入房间系统消息
        await db.collection('messages').doc(roomId).update({
          data: {
            messages: _.push({
              fromOpenid: OPENID,
              fromNickname: nickname,
              fromAvatarFileID: avatarFileID || '',
              content: `${nickname} 加入了房间`,
              messageType: 'join',
              timestamp: db.serverDate()
            })
          }
        })

        return { success: true }
      } catch (error) {
        await transaction.rollback()
        throw error
      }
    }

    // 动作 B：创建房间
    if (action === 'create') {
      const roomName = normalizeDisplayText(payload.roomName, '房间名称', 20)
      const nickname = normalizeDisplayText(payload.nickname, '昵称', 10)
      const avatarFileID = payload.avatarFileID ? normalizeIdentifier(payload.avatarFileID, '头像文件', 512) : ''
      if (!['normal', 'bet'].includes(payload.mode)) throw new Error('房间模式无效')
      // 检查用户是否在其他活跃房间中
      const userRes = await db.collection('users').doc(OPENID).get().catch(() => ({ data: null }))
      if (userRes.data && userRes.data.currentRoomId) {
        const oldRoomRes = await db.collection('rooms').doc(userRes.data.currentRoomId).get().catch(() => null)
        if (oldRoomRes && oldRoomRes.data && oldRoomRes.data.status === 'active') {
          throw new Error('您当前已在其他活跃房间中')
        }
      }

      const roomId = Math.random().toString(36).substr(2, 6).toUpperCase()

      // 临时 URL 不入库；页面始终从永久 fileID 换取可显示的链接。
      const avatarTempUrl = ''

      // 启动事务
      const transaction = await db.startTransaction()
      let qrCodeFileID = null
      
      try {
        await transaction.collection('rooms').doc(roomId).set({
          data: {
            owner: OPENID,
            roomName,
            mode: payload.mode,
            status: 'active',
            pot: 0,
            qrCode: null, // 小程序码初始为空
            lastActiveTime: db.serverDate(),
            createTime: db.serverDate(),
            players: [{
              openid: OPENID,
              nickname,
              avatar: avatarTempUrl,           // 临时 URL（2小时内有效）
              avatarFileID,  // fileID（永久，用于重新获取URL）
              score: 0,
              isExited: false
            }]
          }
        })

        // 创建空消息文档
        await transaction.collection('messages').doc(roomId).set({
          data: {
            messages: [],
            createdAt: db.serverDate()
          }
        })

        await transaction.collection('users').doc(OPENID).update({ data: { currentRoomId: roomId } })

        await transaction.commit()

        // 创建房间系统消息
        await db.collection('messages').doc(roomId).update({
          data: {
            messages: _.push({
              fromOpenid: OPENID,
              fromNickname: nickname,
              fromAvatarFileID: avatarFileID,
              content: `${nickname} 创建了房间`,
              messageType: 'create',
              timestamp: db.serverDate()
            })
          }
        })

        // 异步生成小程序码（不阻塞返回）
        try {
          const qrResult = await cloud.openapi.wxacode.getUnlimited({
            scene: `roomId=${roomId}`,
            page: 'pages/home/home',
            width: 400,
            envVersion: qrVersion,
            checkPath: false
          })

          const uploadRes = await cloud.uploadFile({
            cloudPath: `room-qrcodes/${roomId}.png`,
            fileContent: qrResult.buffer
          })

          qrCodeFileID = uploadRes.fileID

          // 更新房间的 qrCode
          await db.collection('rooms').doc(roomId).update({
            data: { qrCode: qrCodeFileID }
          })
        } catch (qrError) {
          console.error('生成小程序码失败:', qrError)
          // 失败不阻断，qrCode 保持 null
        }

        return { success: true, roomId, qrCode: qrCodeFileID }
      } catch (error) {
        await transaction.rollback()
        throw error
      }
    }
    if (action === 'leave') {
      const { roomId } = payload

      // 先检查房间是否存在（非事务查询）
      const roomExists = await db.collection('rooms').doc(roomId).get().catch(() => null)

      let isLastUser = false

      if (roomExists && roomExists.data) {
        // 保存二维码文件ID（在事务外获取，用于后续删除）
        const qrCodeFileID = roomExists.data.qrCode

        // 房间存在，启动事务处理房间相关操作
        const transaction = await db.startTransaction()
        try {
          const roomRes = await transaction.collection('rooms').doc(roomId).get()
          const room = roomRes.data

          if (room) {
            let players = room.players
            const idx = players.findIndex(p => p.openid === OPENID)

            if (idx > -1) {
              // 检查是否为最后一个玩家（不管是否活跃）
              const playersAfterRemove = [...players]
              playersAfterRemove.splice(idx, 1)

              if (playersAfterRemove.length === 0) {
                // 如果是最后一个玩家，删除房间
                await transaction.collection('rooms').doc(roomId).remove()

                // 删除消息（非事务，不阻塞）
                try {
                  await db.collection('messages').doc(roomId).remove()
                } catch (e) {
                  console.log('消息文档删除失败:', e.message)
                }

                // 清空当前用户房间ID
                await db.collection('users').doc(OPENID).update({
                  data: { currentRoomId: null }
                })
              } else {
                // 如果不是最后一个玩家，正常标记退出
                let newOwner = room.owner
                if (newOwner === OPENID) {
                  // 房主退出，转移给第一个活跃玩家
                  newOwner = playersAfterRemove.find(p => p.openid !== OPENID && !p.isExited)?.openid || OPENID
                }
                await transaction.collection('rooms').doc(roomId).update({
                  data: { players: playersAfterRemove, owner: newOwner }
                })

                // 写入退出消息（在事务内）
                await transaction.collection('messages').doc(roomId).update({
                  data: {
                    messages: db.command.push({
                      fromOpenid: OPENID,
                      fromNickname: players[idx].nickname,
                      fromAvatarFileID: players[idx].avatarFileID || '',
                      content: `${players[idx].nickname} 退出了房间`,
                      messageType: 'leave',
                      timestamp: db.serverDate()
                    })
                  }
                })
              }
            }
          }

          await transaction.commit()

          // 判断是否是最后一个用户（在事务提交后）
          isLastUser = roomExists && roomExists.data && roomExists.data.players && roomExists.data.players.length <= 1

          // 如果是最后一个用户离开，删除云存储中的二维码图片
          if (isLastUser && qrCodeFileID) {
            try {
              await cloud.deleteFile({
                fileList: [qrCodeFileID]
              })
              console.log('最后一个用户离开，二维码文件删除成功:', qrCodeFileID)
            } catch (e) {
              console.log('二维码文件删除失败（可能已被手动删除）:', e.message)
            }
          }
        } catch (error) {
          await transaction.rollback()
          throw error
        }
      }

      // 清理用户的 currentRoomId（非事务操作，移到最后执行）
      await db.collection('users').doc(OPENID).update({ data: { currentRoomId: null } })

      return { success: true, isLastUser }
    }

    // === 动作 D：结算 (更新状态 + 存历史 + 标记删除时间) ===
    if (action === 'settle') {
      const { roomId } = payload
      
      // 先检查房间是否存在（非事务查询）
      const roomCheck = await db.collection('rooms').doc(roomId).get().catch(() => null)
      
      if (!roomCheck || !roomCheck.data) {
        throw new Error('房间不存在')
      }
      
      if (roomCheck.data.owner !== OPENID) throw new Error('权限不足')
      
      // 房间存在且用户有权限，启动事务
      const transaction = await db.startTransaction()
      try {
        const roomRes = await transaction.collection('rooms').doc(roomId).get()
        const room = roomRes.data
        
        assertSettleAllowed(room, OPENID)

        const players = (room.players || []).map(historyPlayer)
        const owner = players.find(player => player.openid === room.owner)

        // 1. 存入新版历史战绩。旧记录不迁移，也不会进入新版列表。
        await transaction.collection('history').add({
          data: {
            schemaVersion: 2,
            roomId,
            roomName: room.roomName,
            endTime: db.serverDate(),
            players,
            participantOpenids: [...new Set(players.map(player => player.openid).filter(Boolean))],
            ownerOpenid: room.owner,
            ownerNickname: owner ? owner.nickname : '',
            settledBy: OPENID,
            mode: room.mode
          }
        })

        // 2. 标记为 settled（保留房间数据供查看，包括原始分数）
        await transaction.collection('rooms').doc(roomId).update({
          data: { status: 'settled' }
        })

        // 3. 清空所有玩家的 currentRoomId
        for (const player of room.players) {
          await transaction.collection('users').doc(player.openid).update({
            data: { currentRoomId: null }
          })
        }

        await transaction.commit()

        // 写入结算系统消息
        await db.collection('messages').doc(roomId).update({
          data: {
            messages: db.command.push({
              fromOpenid: 'SYSTEM',
              fromNickname: '系统',
              content: '本场对局已结算，输赢保存到历史记录',
              messageType: 'settle',
              timestamp: db.serverDate()
            })
          }
        })

        return { success: true, msg: '结算完成' }
      } catch (error) {
        await transaction.rollback()
        throw error
      }
    }

    // === 动作 E：解散 (物理删除 + 不存战绩) ===
    if (action === 'dismiss') {
      const { roomId } = payload

      // 先检查房间是否存在（非事务查询）
      const roomCheck = await db.collection('rooms').doc(roomId).get().catch(() => null)

      if (!roomCheck || !roomCheck.data) {
        throw new Error('房间不存在')
      }

      if (roomCheck.data.owner !== OPENID) throw new Error('权限不足')

      // 保存二维码文件ID（在事务外获取，用于后续删除）
      const qrCodeFileID = roomCheck.data.qrCode

      // 房间存在且用户有权限，启动事务
      const transaction = await db.startTransaction()
      try {
        const roomRes = await transaction.collection('rooms').doc(roomId).get()
        const room = roomRes.data

        if (!room) {
          throw new Error('房间不存在')
        }

        if (room.owner !== OPENID) throw new Error('权限不足')
        if (room.status !== 'active') throw new Error('房间已结束，无法解散')

        // 1. 清空所有玩家的 currentRoomId
        for (const player of room.players) {
          await transaction.collection('users').doc(player.openid).update({
            data: { currentRoomId: null }
          })
        }

        // 2. 物理删除房间
        await transaction.collection('rooms').doc(roomId).remove()

        await transaction.commit()

        // 3. 删除消息文档（事务提交后清理，不阻塞主流程）
        try {
          await db.collection('messages').doc(roomId).remove()
        } catch (e) {
          console.log('消息文档删除失败:', e.message)
        }

        // 4. 删除云存储中的二维码图片（非事务，不阻塞主流程）
        if (qrCodeFileID) {
          try {
            await cloud.deleteFile({
              fileList: [qrCodeFileID]
            })
            console.log('二维码文件删除成功:', qrCodeFileID)
          } catch (e) {
            console.log('二维码文件删除失败（可能已被手动删除）:', e.message)
          }
        }

        return { success: true, msg: '房间已解散' }
      } catch (error) {
        await transaction.rollback()
        throw error
      }
    }
    // === 动作 F：生成房间小程序码 ===
    if (action === 'generateQRCode') {
      const { roomId } = payload
      
      // 1. 检查是否已存在
      const room = await db.collection('rooms').doc(roomId).get()
      if (room.data && room.data.qrCode) {
        return { success: true, fileID: room.data.qrCode }
      }
      
      // 2. 生成小程序码
      const result = await cloud.openapi.wxacode.getUnlimited({
        scene: `roomId=${roomId}`,
        page: 'pages/home/home',
        width: 400,
        envVersion: qrVersion,
        checkPath: false
      })
      
      // 3. 上传到云存储
      const uploadResult = await cloud.uploadFile({
        cloudPath: `room-qrcodes/${roomId}.png`,
        fileContent: result.buffer
      })
      
      // 4. 保存到 rooms 集合
      await db.collection('rooms').doc(roomId).update({
        data: {
          qrCode: uploadResult.fileID
        }
      })
      
      return { success: true, fileID: uploadResult.fileID }
    }

    // === 动作 G：检查用户状态 ===
    if (action === 'checkUserStatus') {
      const user = await db.collection('users').doc(OPENID).get()
      const currentRoomId = user.data ? user.data.currentRoomId : null
      
      if (currentRoomId) {
        // 检查房间是否存在且用户是否在其中
        const room = await db.collection('rooms').doc(currentRoomId).get().catch(() => null)
        if (room && room.data) {
          const isInRoom = room.data.players.some(p => p.openid === OPENID && !p.isExited)
          if (isInRoom && room.data.status === 'active') {
            return { success: true, inRoom: true, roomId: currentRoomId }
          }
        }
      }
      
      return { success: true, inRoom: false }
    }

    // === 动作 H：删除已结算房间记录 ===
    if (action === 'deleteSettledRoom') {
      const { roomId } = payload
      
      // 清理用户的 currentRoomId
      await db.collection('users').doc(OPENID).update({
        data: { currentRoomId: null }
      })
      
      return { success: true, msg: '已清理房间记录' }
    }

    // === 动作 I：更新用户资料 ===
    if (action === 'updateProfile') {
      const roomId = normalizeIdentifier(payload.roomId, '房间ID', 64)
      const nickname = normalizeDisplayText(payload.nickname, '昵称', 10)
      const avatarFileID = payload.avatarFileID ? normalizeIdentifier(payload.avatarFileID, '头像文件', 512) : ''
      
      // 获取房间信息
      const roomRes = await db.collection('rooms').doc(roomId).get()
      if (!roomRes || !roomRes.data) {
        throw new Error('房间不存在')
      }
      
      const room = roomRes.data
      if (room.status !== 'active') throw new Error('房间已结束，无法修改资料')
      
      // 查找当前玩家
      const playerIndex = room.players.findIndex(p => p.openid === OPENID)
      if (playerIndex === -1) {
        throw new Error('您不在该房间中')
      }
      
      // 更新玩家信息
      const updatedPlayers = [...room.players]
      updatedPlayers[playerIndex] = {
        ...updatedPlayers[playerIndex],
        nickname: nickname,
        avatar: '',
        avatarFileID: avatarFileID || updatedPlayers[playerIndex].avatarFileID
      }
      
      // 更新房间数据
      await db.collection('rooms').doc(roomId).update({
        data: { players: updatedPlayers }
      })
      
      // 更新用户集合中的昵称和头像
      await db.collection('users').doc(OPENID).update({
        data: { 
          nickname: nickname,
          avatar: '',
          avatarFileID: avatarFileID || updatedPlayers[playerIndex].avatarFileID
        }
      })
      
      // 添加系统消息通知其他玩家
      const oldNickname = room.players[playerIndex].nickname
      if (oldNickname !== nickname) {
        await db.collection('messages').doc(roomId).update({
          data: {
            messages: _.push({
              fromOpenid: OPENID,
              fromNickname: nickname,
              fromAvatarFileID: updatedPlayers[playerIndex].avatarFileID || '',
              content: `${oldNickname} 修改昵称为 ${nickname}`,
              messageType: 'system',
              timestamp: db.serverDate()
            })
          }
        })
      }
      
      return { success: true, msg: '资料更新成功' }
    }

    // === 动作 J：更新 All In 值 ===
    if (action === 'updateAllInValue') {
      const { roomId, allInValue } = payload
      
      // 检查房间是否存在
      const roomRes = await db.collection('rooms').doc(roomId).get().catch(() => null)
      if (!roomRes || !roomRes.data) {
        throw new Error('房间不存在')
      }
      
      // 检查权限（只有房主可以设置）
      if (roomRes.data.owner !== OPENID) {
        throw new Error('权限不足，只有房主可以设置')
      }
      if (roomRes.data.status !== 'active') throw new Error('房间已结束，无法修改设置')
      if (roomRes.data.mode !== 'bet') throw new Error('只有下注模式可以设置 All In')
      if (!Number.isSafeInteger(allInValue) || allInValue <= 0) throw new Error('All In 值必须是正整数')
      
      // 更新 allInVal
      await db.collection('rooms').doc(roomId).update({
        data: { allInVal: allInValue }
      })
      
      return { success: true, msg: 'All In 值已设置' }
    }

    return { success: false, msg: '未知动作' }

  } catch (e) {
    return { success: false, msg: e.message }
  }
}
