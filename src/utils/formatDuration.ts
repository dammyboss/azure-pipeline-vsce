/**
 * Format duration in milliseconds to human-readable format
 * Examples: "2h 34m 12s", "45m 2s", "23s", "<1s"
 */
export function formatDuration(durationMs: number): string {
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;

    let formatted = '';

    if (hours > 0) {
        formatted += `${hours}h `;
    }

    if (minutes > 0 || hours > 0) {
        formatted += `${remainingMinutes}m `;
    }

    if (seconds < 1) {
        formatted += '<1s';
    } else {
        formatted += `${remainingSeconds}s`;
    }

    return formatted.trim();
}

/**
 * Format duration between two dates
 */
export function formatDurationBetween(start: Date | string, end: Date | string): string {
    const startTime = typeof start === 'string' ? new Date(start) : start;
    const endTime = typeof end === 'string' ? new Date(end) : end;

    const durationMs = endTime.getTime() - startTime.getTime();
    return formatDuration(durationMs);
}

/**
 * Format time ago (e.g., "2 hours ago", "5 minutes ago")
 */
export function formatTimeAgo(date: Date | string): string {
    const now = new Date();
    const past = typeof date === 'string' ? new Date(date) : date;
    const diffMs = now.getTime() - past.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) {
        return 'just now';
    } else if (diffMinutes < 60) {
        return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
        return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else if (diffDays < 7) {
        return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    } else {
        return past.toLocaleDateString();
    }
}
