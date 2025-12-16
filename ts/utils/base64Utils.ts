export function base64ToBytes(base64: string) {
  return new Uint8Array(atob(base64).split("").map(n => n.charCodeAt(0)))
}

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa([...bytes].map((n) => String.fromCharCode(n)).join(""));
}
