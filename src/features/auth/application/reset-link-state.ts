export function readResetLink(search: string): { token: string | null; invalid: boolean } {
  const query = new URLSearchParams(search)
  return {
    token: query.get('token'),
    invalid: query.get('error') === 'INVALID_TOKEN',
  }
}
