export const metadata = {
  title: "3D Lotto Draw Ledger",
  description: "Personal statistics tracker for PCSO 3D Lotto (Swertres)",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0f14", // matches the app's dark background instead of a default white address bar on mobile
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
