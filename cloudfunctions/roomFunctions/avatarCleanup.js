function isManagedAvatarFileID(fileID) {
  return typeof fileID === 'string' && /^cloud:\/\/[^/]+\/avatars\/[^/]+$/.test(fileID)
}

async function deleteReplacedAvatar(cloud, oldFileID, newFileID) {
  if (!oldFileID || oldFileID === newFileID || !isManagedAvatarFileID(oldFileID)) return false
  await cloud.deleteFile({ fileList: [oldFileID] })
  return true
}

module.exports = { isManagedAvatarFileID, deleteReplacedAvatar }
