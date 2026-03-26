import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// パッケージ化アプリは .zshrc 等を読まず PATH が限定されるため明示的に指定する
const EXEC_ENV = {
  ...process.env,
  PATH: [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
    process.env.PATH ?? '',
  ].join(':'),
}

export async function getTailscaleIP(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('tailscale ip -4', { env: EXEC_ENV })
    return stdout.trim()
  } catch {
    return null
  }
}
