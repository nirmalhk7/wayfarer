/**
 * Publishes only the bounded fields needed for Core Web Vitals monitoring.
 * Detailed PerformanceEntry objects can contain element and URL data, so they
 * deliberately stay in the browser.
 */
export function publishWebVital(metric, options) {
  const detail = {
    name: metric.name,
    value: metric.value,
    delta: metric.delta,
    id: metric.id,
    rating: metric.rating,
    navigationType: metric.navigationType,
    pathname: options.pathname,
  };
  options.dispatch("wayfarer:web-vital", detail);
  if (options.endpoint) {
    options.sendBeacon(options.endpoint, JSON.stringify(detail));
  }
}
