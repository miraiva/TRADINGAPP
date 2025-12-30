# Project Setup - Explained

This document explains what we've set up and why, so you can understand the architecture as we build.

## 📁 Project Structure

```
TradingApp/
├── backend/                    # Python FastAPI backend
│   ├── app/
│   │   ├── api/               # API endpoints (routes)
│   │   ├── models/            # Database models (SQLAlchemy)
│   │   ├── services/          # Business logic
│   │   ├── db/               # Database configuration
│   │   └── main.py           # FastAPI app entry point
│   ├── data/                  # SQLite database files (dev)
│   ├── uploads/               # File uploads storage
│   ├── requirements.txt       # Python dependencies
│   └── .env.example          # Environment variables template
│
├── frontend/                  # React frontend
│   ├── src/
│   │   ├── components/        # Reusable React components
│   │   ├── pages/            # Page components
│   │   ├── services/          # API service functions
│   │   ├── utils/            # Utility functions
│   │   ├── App.jsx           # Main app component
│   │   └── main.jsx          # React entry point
│   ├── package.json          # Node.js dependencies
│   └── vite.config.js        # Vite build configuration
│
└── README.md                  # Project documentation
```

## 🔧 What Each Part Does

### Backend (`backend/`)

**FastAPI** - Modern Python web framework, fast and easy to use.

1. **`app/main.py`**
   - Entry point for the FastAPI application
   - Sets up CORS (allows frontend to talk to backend)
   - Defines health check endpoints
   - Loads environment variables

2. **`app/db/database.py`**
   - Database connection setup
   - Supports both PostgreSQL (production) and SQLite (development)
   - Creates database sessions for queries
   - `get_db()` function provides database sessions to API routes

3. **`app/models/`**
   - Will contain SQLAlchemy models (database tables)
   - Each model = one database table
   - We'll create models as we build features

4. **`app/api/`**
   - Will contain API route files
   - Each file = one set of related endpoints
   - Example: `positions.py` for position-related endpoints

5. **`app/services/`**
   - Business logic (not database queries)
   - Example: Calculating NAV, XIRR, profit percentages
   - Keeps API routes clean

### Frontend (`frontend/`)

**React + Vite** - Modern React with fast build tooling.

1. **`src/App.jsx`**
   - Main application component
   - Currently shows welcome screen
   - Will contain routing and layout

2. **`src/main.jsx`**
   - React entry point
   - Renders the App component

3. **`vite.config.js`**
   - Vite configuration
   - Sets up proxy to backend (so API calls work)
   - Configures dev server on port 3000

## 🗄️ Database Choice

**Why SQLite for development?**
- No setup required - works out of the box
- Single file database - easy to backup/reset
- Perfect for learning and development

**Why PostgreSQL for production?**
- Better performance for larger datasets
- Supports concurrent connections
- More features (full-text search, etc.)

The code automatically uses SQLite if no `DATABASE_URL` is set, making it easy to start.

## 🔐 Environment Variables

**`.env` file** - Stores sensitive configuration:
- API keys (Groq, OpenAI, Deepseek)
- Database connection strings
- Secret keys for security

**Why separate from code?**
- Never commit secrets to git
- Different configs for dev/production
- Easy to change without code changes

## 📦 Dependencies Explained

### Backend Dependencies

- **fastapi** - Web framework
- **uvicorn** - ASGI server (runs FastAPI)
- **sqlalchemy** - Database ORM (object-relational mapping)
- **psycopg2-binary** - PostgreSQL driver
- **alembic** - Database migrations (schema changes)
- **pydantic** - Data validation
- **python-dotenv** - Loads .env files
- **groq, openai** - AI model clients
- **httpx** - HTTP client for API calls

### Frontend Dependencies

- **react, react-dom** - React library
- **react-router-dom** - Client-side routing
- **axios** - HTTP client for API calls
- **recharts** - Chart library for visualizations
- **date-fns** - Date manipulation utilities
- **vite** - Build tool (faster than Create React App)

## 🚀 How to Run

### Quick Start (using setup script)

**Mac/Linux:**
```bash
./SETUP.sh
```

**Windows:**
```bash
SETUP.bat
```

### Manual Setup

**Backend:**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and add API keys
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## 🎯 Next Steps

Now that setup is complete, we can start building features:

1. **Database Models** - Define our data structure
2. **API Endpoints** - Create routes for data operations
3. **Frontend Components** - Build the UI
4. **Business Logic** - Implement calculations and rules

Each step will be explained as we go!

## 💡 Key Concepts to Remember

1. **Separation of Concerns**
   - Models = Data structure
   - Services = Business logic
   - API = Interface (what frontend calls)
   - Frontend = User interface

2. **Independent Asset Tracking**
   - Each trade is separate (no averaging)
   - Makes sell decisions clear
   - We'll implement this in the Position model

3. **AI Integration Points**
   - Decision Assistant will use AI models
   - We'll create a service to handle AI calls
   - Multiple models supported (Groq, OpenAI, Deepseek)

Ready to start building! 🚀



