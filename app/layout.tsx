import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CampusMate — A little more room to think",
  description: "A thoughtful student-life planner for classes, deadlines, and everything in between.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
