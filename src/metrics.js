/**
 * Simple metrics collection module
 * Provides timing helpers for measuring operation duration
 */

/**
 * Measure synchronous operation duration
 * @param {Function} fn - Function to execute and measure
 * @returns {{result: any, duration: number, success: true} | {error: Error, duration: number, success: false}}
 */
export function measureTime(fn) {
  const start = Date.now();
  try {
    const result = fn();
    const duration = Date.now() - start;
    return { result, duration, success: true };
  } catch (error) {
    const duration = Date.now() - start;
    return { error, duration, success: false };
  }
}

/**
 * Measure async operation duration
 * @param {Function} fn - Async function to execute and measure
 * @returns {Promise<{result: any, duration: number, success: true} | {error: Error, duration: number, success: false}>}
 */
export async function measureTimeAsync(fn) {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    return { result, duration, success: true };
  } catch (error) {
    const duration = Date.now() - start;
    return { error, duration, success: false };
  }
}
