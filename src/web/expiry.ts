import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// O(1)
function countUnit(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// O(1)
// INV: the countdown is the time left until expiresAt; a past timestamp is already due for the sweeper
export function formatExpiry(expiresAt: string, now: number = Date.now()): string {
  const left = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(left)) return "Deletion time unavailable";
  if (left <= 0) return "Due for deletion";
  if (left < MINUTE_MS) return "Less than a minute left";
  const days = Math.floor(left / DAY_MS);
  const hours = Math.floor((left % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((left % HOUR_MS) / MINUTE_MS);
  if (days > 0) return hours > 0 ? `${countUnit(days, "day", "days")} ${countUnit(hours, "hour", "hours")} left` : `${countUnit(days, "day", "days")} left`;
  if (hours > 0) return minutes > 0 ? `${countUnit(hours, "hour", "hours")} ${countUnit(minutes, "minute", "minutes")} left` : `${countUnit(hours, "hour", "hours")} left`;
  return `${countUnit(minutes, "minute", "minutes")} left`;
}

// O(1)
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
