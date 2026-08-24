export function pagesDashboardUrl(accountId: string, projectName: string): string {
  return `https://dash.cloudflare.com/${encodeURIComponent(accountId)}/pages/view/${encodeURIComponent(projectName)}`;
}
