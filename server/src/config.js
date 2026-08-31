const path = require('node:path')

class ConfigurationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

function required(env, name, maxLength = 256) {
  const value = env[name]
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value) || /^replace-/i.test(value)) {
    throw new ConfigurationError(`${name} 缺失或无效，请检查服务器配置`)
  }
  return value
}

function integer(env, name, fallback, min, max) {
  const raw = env[name] === undefined ? String(fallback) : env[name]
  if (typeof raw !== 'string' || !/^\d+$/u.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) {
    throw new ConfigurationError(`${name} 必须是 ${min}～${max} 的整数`)
  }
  return Number(raw)
}

function choice(env, name, fallback, values) {
  const value = env[name] === undefined ? fallback : env[name]
  if (!values.includes(value)) throw new ConfigurationError(`${name} 不在允许的配置范围内`)
  return value
}

function readDatabaseConfig(env = process.env) {
  const password = required(env, 'PGPASSWORD')
  if (env.NODE_ENV === 'production' && password.length < 24) {
    throw new ConfigurationError('生产环境 PGPASSWORD 至少需要 24 个字符')
  }
  const sslMode = choice(env, 'PGSSLMODE', 'disable', ['disable', 'verify-full'])
  return {
    host: required({ PGHOST: '127.0.0.1', ...env }, 'PGHOST'),
    port: integer(env, 'PGPORT', 5432, 1, 65535),
    database: required(env, 'PGDATABASE', 63),
    user: required(env, 'PGUSER', 63),
    password,
    max: integer(env, 'PGPOOL_MAX', 5, 1, 20),
    ssl: sslMode === 'verify-full' ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
    query_timeout: 7000,
    options: '-c lock_timeout=2000 -c idle_in_transaction_session_timeout=10000',
    application_name: 'gameintegrator'
  }
}

function readConfig(env = process.env) {
  const nodeEnv = choice(env, 'NODE_ENV', 'development', ['development', 'test', 'production'])
  const appId = required(env, 'WECHAT_APP_ID')
  const appSecret = required(env, 'WECHAT_APP_SECRET')
  if (!/^wx[0-9a-f]{16}$/u.test(appId)) throw new ConfigurationError('WECHAT_APP_ID 格式无效')
  if (!/^[0-9a-f]{32}$/iu.test(appSecret)) throw new ConfigurationError('WECHAT_APP_SECRET 格式无效')
  const avatarDirectory = required({ AVATAR_STORAGE_DIR: path.join(__dirname, '..', 'data', 'avatars'), ...env }, 'AVATAR_STORAGE_DIR', 1024)
  if (!path.isAbsolute(avatarDirectory) || path.resolve(avatarDirectory) === path.parse(avatarDirectory).root) {
    throw new ConfigurationError('AVATAR_STORAGE_DIR 必须是专用目录的绝对路径，不能是磁盘根目录')
  }
  return {
    nodeEnv,
    avatarDirectory,
    host: required({ HOST: '127.0.0.1', ...env }, 'HOST'),
    port: integer(env, 'PORT', 3000, 1, 65535),
    logLevel: choice(env, 'LOG_LEVEL', 'info', ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
    trustProxyHops: integer(env, 'TRUST_PROXY_HOPS', 0, 0, 1),
    loginRateLimitMax: integer(env, 'LOGIN_RATE_LIMIT_MAX', 10, 1, 60),
    websocketMaxConnections: integer(env, 'WEBSOCKET_MAX_CONNECTIONS', 200, 1, 1000),
    websocketHeartbeatMs: integer(env, 'WEBSOCKET_HEARTBEAT_MS', 30000, 10000, 60000),
    sessionTtlSeconds: integer(env, 'SESSION_TTL_SECONDS', 604800, 300, 2592000),
    wechat: { appId, appSecret, timeoutMs: integer(env, 'WECHAT_TIMEOUT_MS', 5000, 1000, 15000) },
    database: readDatabaseConfig({ ...env, NODE_ENV: nodeEnv })
  }
}

module.exports = { ConfigurationError, readConfig, readDatabaseConfig }
