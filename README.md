# ⚡ Dipole - Deploy can be even Faster

> AI-powered deployment automation that makes web deployment as simple as a conversation.

## 🌟 What is Dipole?

Dipole is an intelligent deployment assistant that combines the power of AI with modern deployment platforms. Simply chat with our AI agent, provide your project path, and watch as it automatically analyzes, plans, and deploys your web applications to Netlify or Vercel.

### ✨ Key Features

- **🤖 AI-Powered Decisions**: Smart project analysis and deployment strategy selection
- **📊 Real-Time Progress**: Visual progress tracking with live log streaming
- **🚀 Multi-Platform Support**: Deploy to Netlify or Vercel with CLI or API methods
- **📱 Mobile-Friendly Sharing**: QR codes and instant URL sharing
- **🔧 Advanced Diagnostics**: Built-in log analysis and troubleshooting tools
- **💬 Conversational Interface**: Natural language deployment commands

## 🚀 Quick Start

### Prerequisites

Before using Dipole, ensure you have:

1. **Node.js** (v18 or higher)
2. **Python** (v3.9 or higher)
3. **OpenAI API Key** - Get one from [OpenAI Platform](https://platform.openai.com/api-keys)
4. **Deployment Platform Access**:
   - **Netlify**: [Create account](https://app.netlify.com/signup) and get CLI token
   - **Vercel**: [Create account](https://vercel.com/signup) and get CLI token

### Installation

1. **Clone the repository**:
   ```bash
   git clone <your-repo-url>
   cd fast_deploy
   ```

2. **Install dependencies**:
   ```bash
   # Install Python dependencies
   pip install -r demo/requirements.txt
   
   # Install Node.js dependencies
   npm install
   ```

3. **Configure environment variables**:
   ```bash
   # Copy the example environment file
   cp .env.example .env
   
   # Edit .env with your API keys
   OPENAI_API_KEY=your_openai_api_key_here
   ```

4. **Set up deployment platforms**:
   
   **For Netlify:**
   ```bash
   npm install -g netlify-cli
   netlify login
   ```
   
   **For Vercel:**
   ```bash
   npm install -g vercel
   vercel login
   ```

### Launch Dipole

```bash
streamlit run demo/streamlit_app.py
```

Open your browser to `http://localhost:8501` and start deploying!

## 💡 How to Use

1. **Start a conversation**: Open the Dipole interface
2. **Provide your project path**: Tell the AI where your project is located
3. **Choose deployment options**: Ask to switch providers or methods if needed
4. **Deploy**: Say "Deploy now" and watch the magic happen
5. **Share**: Use QR codes or direct links to share your deployed site

### Example Conversation

```
You: My project is at /Users/john/my-react-app
AI: I'll analyze your React project and create a deployment plan.

You: Use Netlify CLI instead
AI: Updated preferences to use Netlify CLI method.

You: Deploy now
AI: Starting deployment... [Progress tracking and live logs appear]
```

## 🛠️ Advanced Features

### Environment Variables

- `OPENAI_API_KEY`: Required for AI functionality
- `FAST_DEPLOY_MOCK`: Set to `success`/`fail`/`rate_limit` for testing without real deployments

### Supported Project Types

- React (Create React App, Vite)
- Next.js
- Vue.js
- Static HTML/CSS/JS
- Gatsby
- Nuxt.js
- And many more...

### Deployment Methods

- **CLI Method**: Uses platform CLI tools (recommended)
- **API Method**: Direct API integration (faster, requires additional setup)

## 🔧 Troubleshooting

### Common Issues

1. **"No OpenAI API key found"**
   - Ensure `OPENAI_API_KEY` is set in your `.env` file

2. **"Command not found: netlify/vercel"**
   - Install the respective CLI tools globally

3. **"Permission denied"**
   - Run `netlify login` or `vercel login` to authenticate

4. **Preview not showing**
   - Some platforms block iframe embedding; use the external link button

### Getting Help

- Check the **Logs** tab for detailed deployment information
- Use the **Diagnose** tool for automatic error analysis
- Copy logs using the built-in copy/download buttons

## 🌐 Deployment Platforms

### Netlify
- **Pros**: Excellent for static sites, great free tier, form handling
- **Setup**: `netlify login` after installing CLI
- **Best for**: JAMstack sites, static generators, React apps

### Vercel
- **Pros**: Optimized for Next.js, edge functions, great performance
- **Setup**: `vercel login` after installing CLI  
- **Best for**: Next.js, React, serverless functions

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Streamlit](https://streamlit.io/) and [LangChain](https://langchain.com/)
- Powered by [OpenAI](https://openai.com/) GPT models
- Deployment platforms: [Netlify](https://netlify.com/) and [Vercel](https://vercel.com/)

---

**Ready to make deployment faster?** [Launch Dipole](#-quick-start) and experience the future of web deployment! ⚡
