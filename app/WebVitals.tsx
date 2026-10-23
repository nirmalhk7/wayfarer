"use client";

import { useEffect } from "react";
import { onCLS, onINP, onLCP, type Metric } from "web-vitals";

import { publishWebVital } from "./web-vitals-reporter.mjs";

const endpoint = process.env.NEXT_PUBLIC_WEB_VITALS_ENDPOINT ?? "";

export function WebVitals() {
  useEffect(() => {
    const report = (metric: Metric) => publishWebVital(metric, {
      endpoint,
      pathname: window.location.pathname,
      dispatch: (name: string, detail: unknown) => {
        window.dispatchEvent(new CustomEvent(name, { detail }));
      },
      sendBeacon: navigator.sendBeacon
        ? navigator.sendBeacon.bind(navigator)
        : () => false,
    });
    onCLS(report);
    onINP(report);
    onLCP(report);
  }, []);

  return null;
}
