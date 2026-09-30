import localFont from "next/font/local";

export const inter = localFont({
  src: "./inter-normal-100-900-585d95c7.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-inter",
});

export const inter2 = localFont({
  src: [
    { path: "./inter-normal-100-900-585d95c7.woff2", weight: "400", style: "normal" },
    { path: "./inter-normal-100-900-585d95c7.woff2", weight: "500", style: "normal" },
    { path: "./inter-normal-100-900-585d95c7.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});
