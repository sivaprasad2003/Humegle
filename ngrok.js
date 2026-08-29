const ngrok = require("@ngrok/ngrok");

// Automatically load variables from .env file (requires Node 21+)
try {
  process.loadEnvFile('.env');
} catch (e) {
  console.log("No .env file found or Node version is too old.");
}

async function forwardToApp() {
  // Make sure NGROK_AUTHTOKEN is in your environment variables
  const session = await new ngrok.SessionBuilder().authtokenFromEnv().connect();
  
  const listener = await session
    .httpEndpoint()
    .domain("cube-attic-happiest.ngrok-free.dev")
    .poolingEnabled(true)
    // NOTE: Changed this to 3000 so it forwards to your Next.js app!
    // (If you meant to forward the backend, change it to 8080)
    .listenAndForward("http://localhost:3000");
    
  console.log(`Available at: ${listener.url()}`);
  console.log("Ngrok tunnel is now running. Press Ctrl+C to stop.");
  
  // Keep the process alive so the tunnel doesn't close!
  process.stdin.resume();
}

forwardToApp();
