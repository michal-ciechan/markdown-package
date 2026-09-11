export async function trackTableObservers(page) {
  await page.addInitScript(() => {
    const NativeObserver = window.ResizeObserver;
    window.tableObservers = [];
    window.ResizeObserver = class extends NativeObserver {
      constructor(callback) {
        super(callback);
        this.rows = new Set();
        window.tableObservers.push(this);
      }
      observe(target, options) {
        if (target.matches('tr')) this.rows.add(target);
        super.observe(target, options);
      }
      unobserve(target) { this.rows.delete(target); super.unobserve(target); }
      disconnect() { this.rows.clear(); super.disconnect(); }
    };
  });
}

export const observedRows = page => page.evaluate(() =>
  window.tableObservers.map(observer => observer.rows.size).filter(Boolean));
