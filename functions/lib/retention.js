export function santaDeletionDeadline(now = new Date()) {
  const current = new Date(now);
  let year = current.getUTCFullYear();
  let deadline = new Date(Date.UTC(year, 0, 31, 23, 59, 59));
  if (current >= deadline) deadline = new Date(Date.UTC(year + 1, 0, 31, 23, 59, 59));
  return deadline;
}

export function santaExpirationTtl(now = new Date()) {
  const seconds = Math.ceil((santaDeletionDeadline(now).getTime() - new Date(now).getTime()) / 1000);
  return Math.max(60, seconds);
}
