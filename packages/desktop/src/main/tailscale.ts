import { execAsync, EXEC_ENV } from './exec-env'

export async function getTailscaleIP(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('tailscale ip -4', { env: EXEC_ENV })
    return stdout.trim()
  } catch {
    return null
  }
}
