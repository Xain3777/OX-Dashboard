export function formatTime(ts: string) {
  return new Date(ts).toLocaleString("ar-SY", {
    timeZone: "Asia/Damascus",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString("ar-SY", {
    timeZone: "Asia/Damascus",
  });
}
