"""
AI Assistant API Endpoints
Handles AI-powered stock comparison recommendations
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import os
import json
import logging
from openai import OpenAI
from groq import Groq

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-assistant", tags=["ai-assistant"])

# Initialize clients
openai_client = None
groq_client = None

def get_openai_client():
    """Get OpenAI client"""
    global openai_client
    if openai_client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")
        openai_client = OpenAI(api_key=api_key)
    return openai_client

def get_groq_client():
    """Get Groq client"""
    global groq_client
    if groq_client is None:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured")
        groq_client = Groq(api_key=api_key)
    return groq_client


class AIComparisonRequest(BaseModel):
    """Request model for AI stock comparison"""
    symbol_to_sell: str = Field(..., description="Symbol of stock to sell")
    current_price: float = Field(..., description="Current price of stock to sell")
    model: str = Field(default="chatgpt-mini", description="AI model: chatgpt, chatgpt-mini, or deepseek")
    indicators: List[str] = Field(default_factory=list, description="Selected financial indicators")


class ComparisonStock(BaseModel):
    """Model for a comparison stock recommendation"""
    symbol: str
    targetPrice: float
    probability: int = Field(ge=0, le=100)


class AIComparisonResponse(BaseModel):
    """Response model for AI stock comparison"""
    stocks: List[ComparisonStock] = Field(..., description="Exactly 3 comparison stocks")


@router.post("/compare", response_model=AIComparisonResponse)
async def get_ai_comparison(request: AIComparisonRequest):
    """
    Get AI-powered stock comparison recommendations
    
    Returns exactly 3 comparison stocks with target prices and probabilities
    """
    try:
        # Build prompt
        indicators_text = ", ".join(request.indicators) if request.indicators else "basic market data"
        
        prompt = f"""You are a stock market analysis assistant. Analyze the Indian stock market (NSE) and recommend exactly 3 alternative stocks to compare against selling {request.symbol_to_sell} (current price: ₹{request.current_price}).

Consider these indicators: {indicators_text}

Return ONLY valid JSON in this exact format (no explanations, no markdown, no code blocks):
{{
  "stocks": [
    {{"symbol": "SYMBOL1", "targetPrice": 1234.56, "probability": 75}},
    {{"symbol": "SYMBOL2", "targetPrice": 2345.67, "probability": 80}},
    {{"symbol": "SYMBOL3", "targetPrice": 3456.78, "probability": 70}}
  ]
}}

Requirements:
- Exactly 3 stocks (no more, no less)
- Use valid NSE stock symbols (e.g., RELIANCE, TCS, INFY)
- targetPrice must be a positive number
- probability must be between 0 and 100
- If confidence is low, still return 3 stocks with lower probabilities
- Return ONLY the JSON object, nothing else"""

        # Call appropriate AI model
        if request.model == "chatgpt":
            client = get_openai_client()
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a financial analysis assistant. Always return valid JSON only, no explanations."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=500
            )
            content = response.choices[0].message.content.strip()
        elif request.model == "chatgpt-mini":
            client = get_openai_client()
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a financial analysis assistant. Always return valid JSON only, no explanations."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=500
            )
            content = response.choices[0].message.content.strip()
        elif request.model == "deepseek":
            client = get_groq_client()
            # Try DeepSeek model, fallback to Llama if not available
            try:
                response = client.chat.completions.create(
                    model="deepseek-r1-distill-llama-70b",
                    messages=[
                        {"role": "system", "content": "You are a financial analysis assistant. Always return valid JSON only, no explanations."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.3,
                    max_tokens=500
                )
            except Exception:
                # Fallback to Llama if DeepSeek model not available
                response = client.chat.completions.create(
                    model="llama-3.1-70b-versatile",
                    messages=[
                        {"role": "system", "content": "You are a financial analysis assistant. Always return valid JSON only, no explanations."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.3,
                    max_tokens=500
                )
            content = response.choices[0].message.content.strip()
        else:
            raise HTTPException(status_code=400, detail=f"Unknown model: {request.model}")

        # Parse JSON response (handle markdown code blocks if present)
        content = content.strip()
        if content.startswith("```"):
            # Remove markdown code blocks
            lines = content.split("\n")
            content = "\n".join(lines[1:-1]) if len(lines) > 2 else content
        elif content.startswith("```json"):
            lines = content.split("\n")
            content = "\n".join(lines[1:-1]) if len(lines) > 2 else content
        
        # Parse JSON
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response: {content}")
            # Fallback: try to extract JSON from response
            import re
            json_match = re.search(r'\{[^{}]*"stocks"[^{}]*\[[^\]]*\][^{}]*\}', content, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group())
            else:
                raise HTTPException(status_code=500, detail=f"AI returned invalid JSON: {str(e)}")

        # Validate response structure
        if "stocks" not in data:
            raise HTTPException(status_code=500, detail="AI response missing 'stocks' field")
        
        stocks = data["stocks"]
        if not isinstance(stocks, list) or len(stocks) != 3:
            raise HTTPException(status_code=500, detail=f"AI must return exactly 3 stocks, got {len(stocks) if isinstance(stocks, list) else 'non-list'}")

        # Validate each stock
        validated_stocks = []
        for i, stock in enumerate(stocks):
            if not isinstance(stock, dict):
                raise HTTPException(status_code=500, detail=f"Stock {i+1} is not an object")
            if "symbol" not in stock or "targetPrice" not in stock:
                raise HTTPException(status_code=500, detail=f"Stock {i+1} missing required fields")
            
            symbol = str(stock["symbol"]).upper().strip()
            try:
                target_price = float(stock["targetPrice"])
                probability = int(stock.get("probability", 50))
            except (ValueError, TypeError):
                raise HTTPException(status_code=500, detail=f"Stock {i+1} has invalid targetPrice or probability")
            
            if target_price <= 0:
                raise HTTPException(status_code=500, detail=f"Stock {i+1} targetPrice must be positive")
            if probability < 0 or probability > 100:
                probability = max(0, min(100, probability))  # Clamp to valid range
            
            validated_stocks.append({
                "symbol": symbol,
                "targetPrice": target_price,
                "probability": probability
            })

        return AIComparisonResponse(stocks=validated_stocks)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in AI comparison: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"AI comparison failed: {str(e)}")

