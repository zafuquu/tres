export const metadata = {
  title: "3D Lotto Draw Ledger",
  description: "Personal statistics tracker for PCSO 3D Lotto (Swertres)",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
