export function contentSecurityPolicy(development: boolean): string {
  const style = development ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'";
  const connect = development ? "connect-src 'self' ws://localhost:*" : "connect-src 'none'";
  return [
    "default-src 'self'",
    "script-src 'self'",
    style,
    "img-src 'self' data:",
    "font-src 'self'",
    connect,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
