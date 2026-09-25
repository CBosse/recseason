export function useLocalEmulators(location) {
  const requested = new URLSearchParams(location.search).get('emulator') === '1';
  if (requested && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    throw new Error('Emulator mode is restricted to localhost.');
  }
  return requested;
}
