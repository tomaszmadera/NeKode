import { isTrustedSender } from './sender-guard'

export function allowsMicrophone(
  permission: string,
  requestingUrl: string | undefined,
  isMainFrame: boolean,
  mediaTypes: readonly string[] | undefined,
  trustedUrls: readonly string[],
): boolean {
  return (
    permission === 'media' &&
    isTrustedSender({ url: requestingUrl, isMainFrame }, trustedUrls) &&
    mediaTypes?.length === 1 &&
    mediaTypes[0] === 'audio'
  )
}

export function allowsRendererClipboard(
  permission: string,
  requestingUrl: string | undefined,
  isMainFrame: boolean,
  trustedUrls: readonly string[],
): boolean {
  return (
    ['clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read'].includes(
      permission,
    ) && isTrustedSender({ url: requestingUrl, isMainFrame }, trustedUrls)
  )
}
