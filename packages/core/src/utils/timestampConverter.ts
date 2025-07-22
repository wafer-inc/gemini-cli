export interface TimestampConversionOptions {
  timestampColumns?: string[];
  dateFormat?: 'iso' | 'locale' | 'relative';
  locale?: string;
}

/**
 * Converts Unix timestamps in query results to human-readable dates
 */
export function convertTimestampsInResults(
  results: any[], 
  options: TimestampConversionOptions = {}
): any[] {
  const { timestampColumns = [], dateFormat = 'locale', locale = 'en-US' } = options;
  
  if (results.length === 0) {
    return results;
  }

  return results.map(row => {
    const convertedRow = { ...row };
    
    for (const [key, value] of Object.entries(row)) {
      // Auto-detect potential timestamp columns or use specified columns
      const shouldConvert = timestampColumns.length > 0 
        ? timestampColumns.includes(key)
        : isLikelyTimestamp(key, value);
        
      if (shouldConvert && value) {
        convertedRow[key] = formatTimestamp(value, dateFormat, locale);
      }
    }
    
    return convertedRow;
  });
}

/**
 * Detects if a column/value pair is likely a timestamp
 */
function isLikelyTimestamp(columnName: string, value: any): boolean {
  // Check column name patterns
  const timestampColumnPatterns = [
    /timestamp/i,
    /created_at/i,
    /updated_at/i,
    /modified_at/i,
    /date_/i,
    /_date/i,
    /time/i
  ];
  
  const hasTimestampName = timestampColumnPatterns.some(pattern => 
    pattern.test(columnName)
  );
  
  // Check if value looks like a Unix timestamp
  if (typeof value === 'number') {
    // Unix timestamps are typically between 1970 and 2100
    const min = 0; // 1970-01-01
    const max = 4102444800; // 2100-01-01
    return value >= min && value <= max;
  }
  
  // Check if string value looks like a Unix timestamp
  if (typeof value === 'string') {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      const min = 0;
      const max = 4102444800;
      return num >= min && num <= max && hasTimestampName;
    }
  }
  
  return hasTimestampName && value != null;
}

/**
 * Formats a timestamp value to human-readable format
 */
function formatTimestamp(value: any, format: string, locale: string): string {
  if (typeof value === 'string') {
    // Handle array of timestamps like "[1234567890,1234567891]"
    const arrayMatch = value.match(/^\[(.+)\]$/);
    if (arrayMatch) {
      const timestampsStr = arrayMatch[1];
      const timestamps = timestampsStr.split(',').map(t => t.trim());
      
      if (timestamps.length > 1) {
        // Multiple timestamps - convert each and return as a list
        const convertedDates = timestamps.map(ts => {
          const num = parseFloat(ts);
          if (isNaN(num)) return ts;
          return formatSingleTimestamp(num, format, locale);
        });
        return `[${convertedDates.join(', ')}]`;
      } else if (timestamps.length === 1) {
        // Single timestamp in brackets
        const num = parseFloat(timestamps[0]);
        if (!isNaN(num)) {
          return formatSingleTimestamp(num, format, locale);
        }
      }
    }
    
    // Try parsing as regular number string
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return formatSingleTimestamp(num, format, locale);
    }
    
    // Try parsing as ISO date string
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return formatSingleTimestamp(date.getTime() / 1000, format, locale);
    }
    
    return value; // Return original if can't parse
  } else if (typeof value === 'number') {
    return formatSingleTimestamp(value, format, locale);
  } else {
    return String(value);
  }
}

/**
 * Formats a single timestamp number to human-readable format
 */
function formatSingleTimestamp(timestamp: number, format: string, locale: string): string {
  // Handle both seconds and milliseconds timestamps
  if (timestamp > 1e12) {
    timestamp = timestamp / 1000; // Convert from milliseconds to seconds
  }
  
  const date = new Date(timestamp * 1000);
  
  if (isNaN(date.getTime())) {
    return String(timestamp); // Return original if invalid
  }
  
  switch (format) {
    case 'iso':
      return date.toISOString();
    case 'relative':
      return formatRelativeTime(date);
    case 'locale':
    default:
      return date.toLocaleString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
  }
}

/**
 * Formats time relative to now (e.g., "2 hours ago")
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSecs < 60) {
    return `${diffSecs} seconds ago`;
  } else if (diffMins < 60) {
    return `${diffMins} minutes ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hours ago`;
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString();
  }
}