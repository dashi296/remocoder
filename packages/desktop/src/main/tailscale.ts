import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function getTailscaleIP(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('tailscale ip -4')
    return stdout.trim()
  } catch {
    return null
  }
}
