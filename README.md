# Personal Trading App

A comprehensive personal trading application that serves as a one-stop solution for managing all investment accounts. Focuses on swing trading with independent deal tracking (no cost averaging) and AI-powered decision validation.

## 🚀 Tech Stack

- **Backend**: Python 3.8+ with FastAPI
- **Frontend**: React 18 with Vite
- **Database**: PostgreSQL (production) / SQLite (development)
- **AI Models**: Groq, OpenAI, Deepseek
- **Charts**: Recharts

## 📁 Project Structure

```
TradingApp/
├── backend/
│   ├── app/
│   │   ├── api/          # API routes/endpoints
│   │   ├── models/       # Database models (SQLAlchemy)
│   │   ├── services/     # Business logic
│   │   └── db/          # Database configuration
│   ├── data/            # SQLite database files (dev)
│   ├── uploads/         # File uploads
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── pages/       # Page components
│   │   ├── services/    # API services
│   │   └── utils/       # Utility functions
│   ├── package.json
│   └── vite.config.js
└── README.md
```

## 🛠️ Setup Instructions

### Prerequisites

- Python 3.8 or higher
- Node.js 18 or higher
- PostgreSQL (optional, SQLite works for development)
- At least one AI API key (Groq, OpenAI, or Deepseek)

### Backend Setup

1. **Navigate to backend directory**
   ```bash
   cd backend
   ```

2. **Create virtual environment**
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env and add your API keys and database URL
   ```

5. **Run the server**
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```

### Frontend Setup

1. **Navigate to frontend directory**
   ```bash
   cd frontend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run development server**
   ```bash
   npm run dev
   ```

4. **Open browser**
   ```
   http://localhost:3000
   ```

## 📝 Environment Variables

Copy `backend/.env.example` to `backend/.env` and configure:

- `DATABASE_URL`: PostgreSQL connection string or SQLite path
- `GROQ_API_KEY`: Your Groq API key (optional)
- `OPENAI_API_KEY`: Your OpenAI API key (optional)
- `DEEPSEEK_API_KEY`: Your Deepseek API key (optional)

## 🎯 Key Features

- **Portfolio Management**: Centralized view of all positions
- **Trade Tracking**: Independent asset tracking (no cost averaging)
- **Decision Assistant**: AI-powered sell/buy recommendations
- **Analytics**: Charts, metrics, and performance tracking
- **Multi-Account**: Support for multiple broker accounts
- **Transaction Management**: Payin/payout tracking with NAV calculations

## 📚 Development

This project follows a step-by-step learning approach. Features are built incrementally with explanations.

See `PROJECT_PLANNING.md` for detailed features, epics, and user stories.

## 📄 License

[Add your license here]





