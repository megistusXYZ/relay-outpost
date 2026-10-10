/** Opens the one wider-network sheet from anywhere (WiderNetworkSheetHost
 *  listens). Its own tiny module so a door can be rendered — and tested —
 *  without pulling in the sheet, the auth context and the socket layer. */
export const WIDER_NETWORK_OPEN_EVENT = "relay-outpost:open-wider-network-sheet";

export function openWiderNetworkSheet(): void {
  try { window.dispatchEvent(new Event(WIDER_NETWORK_OPEN_EVENT)); } catch {}
}
