import { exec } from 'child_process'
import { promisify } from 'util'

// パッケージ化アプリは .zshrc 等を読まず PATH が限定されるため明示的に指定する
export const EXEC_ENV = {
  ...process.env,
  PATH: [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
    process.env.PATH ?? '',
  ].join(':'),
}

export const execAsync = promisify(exec)
