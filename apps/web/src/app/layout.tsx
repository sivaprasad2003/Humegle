import './globals.css';

export const metadata = {
  title: 'Random Chat',
  description: 'Anonymous random video and text chat',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}