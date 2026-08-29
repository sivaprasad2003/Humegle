# 🌟 Humegle

![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)
![Open Source](https://img.shields.io/badge/Open%20Source-%E2%9D%A4-red?style=flat-square)
![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat-square&logo=next.js)
![Socket.io](https://img.shields.io/badge/Socket.io-Realtime-black?style=flat-square&logo=socket.io)

**Humegle** is a production-ready, open-source random video and text chat platform inspired by classic services like Omegle. Built with a modern tech stack, it prioritizes horizontal scalability, atomic matchmaking, and secure peer-to-peer WebRTC connections.

---

## ✨ Features

- **🎥 Peer-to-Peer Video Chat:** Ultra-low latency video and audio powered by WebRTC.
- **💬 Real-Time Messaging:** Instant text chat synced via Socket.io.
- **⚡ Atomic Matchmaking:** Redis-backed queues prevent race conditions and duplicate matches.
- **🎯 Smart Routing:** Match with others based on Gender and Interest preferences.
- **🟢 Live Presence:** Real-time online user tracking and connection state UI.
- **⏭️ Instant Skip/Next:** Graceful disconnects and immediate re-queuing.
- **📱 Responsive UI:** Mobile-first design with Tailwind CSS and Picture-in-Picture local video.

---

## 🛠️ Tech Stack

**Frontend:** Next.js 14, React, Tailwind CSS, Zustand (State Management)  
**Backend:** Node.js, Socket.io (WebSocket Signaling)  
**Databases:** Redis (Matchmaking & Session State), PostgreSQL & Prisma (Analytics & Reports)  
**Infrastructure:** Docker, Docker Compose, Coturn (STUN/TURN)  

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v18 or higher)
- **Docker & Docker Compose** (for Redis and PostgreSQL)
- **Git**

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/humegle.git
cd humegle
```

### 2. Start the Infrastructure (Databases)

```bash
docker-compose up -d
```

### 3. Setup & Run the Backend Server

```bash
cd apps/server
npm install
npx tsx src/index.ts
```

The signaling server will start on `http://localhost:8080`.

### 4. Setup & Run the Frontend

Open a new terminal window:

```bash
cd apps/web
npm install
npm run dev
```

The website will be live at `http://localhost:3000`.

> **Testing on Mobile?**  
> WebRTC requires a secure HTTPS context. To test on external devices, use ngrok:  
> ```bash
> npx ngrok http 3000
> ```  
> Then open the generated HTTPS link on your phone.

---

## 🤝 Open to Collaboration & Forking

This project is 100% open-source and actively looking for contributors! Whether you are a beginner or a senior engineer, your help is welcome.

Feel free to **Fork** this repository, modify it, use it for your own projects, or submit **Pull Requests** back upstream.

We are currently looking for help with:

- 🛡️ Implementing robust moderation tools & reporting systems.
- 🌐 Coturn (TURN server) production deployment guides.
- 🎨 UI/UX enhancements and accessibility improvements.
- 🤖 Anti-bot and rate-limiting integrations.

### How to Contribute

1. **Fork the Project**
2. **Create your Feature Branch**  
   ```bash
   git checkout -b feature/AmazingFeature
   ```
3. **Commit your Changes**  
   ```bash
   git commit -m 'Add some AmazingFeature'
   ```
4. **Push to the Branch**  
   ```bash
   git push origin feature/AmazingFeature
   ```
5. **Open a Pull Request**

---

## 💖 Support the Project

If you found this project helpful, learned something from the code, or plan to use it, please consider supporting it!

- ⭐ **Star this repository** to help others find it!
- 📤 **Share it** with your developer friends.
- 🐛 **Report bugs** by opening an issue.

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.