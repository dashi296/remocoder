import { exec } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

// パッケージ化アプリは .zshrc 等を読まず PATH が限定されるため明示的に指定する
const home = homedir()
export const EXEC_ENV = {
  ...process.env,
  PATH: [
    join(home, '.local/bin'),
    join(home, '.cargo/bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
    process.env.PATH ?? '',
  ].join(':'),
}

export const execAsync = promisify(exec)
