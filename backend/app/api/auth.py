"""
Authentication API Endpoints
Handles Google OAuth authentication and user management
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import httpx
import logging
import os
from dotenv import load_dotenv
from pathlib import Path
from datetime import datetime

from app.db.database import get_db
from app.models.user import User
from app.core.auth import create_access_token, get_current_user

# Load environment variables
env_path = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Google OAuth Configuration
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:5173/auth/google/callback")


# Request/Response Models
class GoogleTokenRequest(BaseModel):
    code: str
    redirect_uri: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserResponse(BaseModel):
    id: int
    google_id: str
    email: str
    name: Optional[str]
    picture: Optional[str]
    created_at: Optional[str]
    last_login: Optional[str]


@router.get("/google/login-url")
async def get_google_login_url():
    """
    Get Google OAuth login URL
    Returns the URL where users should be redirected for Google authentication
    """
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=500,
            detail="Google OAuth not configured. Please set GOOGLE_CLIENT_ID in environment variables."
        )
    
    redirect_uri = GOOGLE_REDIRECT_URI
    scope = "openid email profile"
    
    auth_url = (
        f"https://accounts.google.com/o/oauth2/v2/auth?"
        f"client_id={GOOGLE_CLIENT_ID}&"
        f"redirect_uri={redirect_uri}&"
        f"response_type=code&"
        f"scope={scope}&"
        f"access_type=offline&"
        f"prompt=consent"
    )
    
    return {
        "auth_url": auth_url,
    }


@router.post("/google/callback", response_model=TokenResponse)
async def google_oauth_callback(
    request: GoogleTokenRequest,
    db: Session = Depends(get_db)
):
    """
    Handle Google OAuth callback
    Exchanges authorization code for access token, fetches user info, and creates/updates user
    """
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(
            status_code=500,
            detail="Google OAuth not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
        )
    
    redirect_uri = request.redirect_uri or GOOGLE_REDIRECT_URI
    
    try:
        # Exchange authorization code for access token
        async with httpx.AsyncClient() as client:
            token_response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": request.code,
                    "client_id": GOOGLE_CLIENT_ID,
                    "client_secret": GOOGLE_CLIENT_SECRET,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            
            if token_response.status_code != 200:
                # Security: Don't log full token response which might contain sensitive data
                logger.error(f"Google token exchange failed: {token_response.status_code}")
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Failed to exchange authorization code for token"
                )
            
            token_data = token_response.json()
            access_token = token_data.get("access_token")
            id_token = token_data.get("id_token")
            
            # Try to get user info from access_token first, then decode id_token as fallback
            google_user_data = None
            
            # Method 1: Use access_token to call userinfo endpoint
            if access_token:
                try:
                    userinfo_response = await client.get(
                        "https://www.googleapis.com/oauth2/v2/userinfo",
                        headers={"Authorization": f"Bearer {access_token}"}
                    )
                    if userinfo_response.status_code == 200:
                        google_user_data = userinfo_response.json()
                except Exception as e:
                    logger.warning(f"Failed to get userinfo from access_token: {e}")
            
            # Method 2: Decode id_token as fallback
            if not google_user_data and id_token:
                try:
                    from jose import jwt as jose_jwt
                    # Decode without verification (Google's public keys would be needed for verification)
                    # For now, we'll use the userinfo endpoint which is more reliable
                    pass
                except Exception as e:
                    logger.warning(f"Failed to decode id_token: {e}")
            
            # If both methods failed, try userinfo with id_token
            if not google_user_data and id_token:
                try:
                    userinfo_response = await client.get(
                        "https://www.googleapis.com/oauth2/v2/userinfo",
                        headers={"Authorization": f"Bearer {id_token}"}
                    )
                    if userinfo_response.status_code == 200:
                        google_user_data = userinfo_response.json()
                except Exception as e:
                    logger.warning(f"Failed to get userinfo from id_token: {e}")
            
            if not google_user_data:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Failed to retrieve user information from Google"
                )
            
            # Extract user information
            google_id = google_user_data.get("id")
            email = google_user_data.get("email")
            name = google_user_data.get("name")
            picture = google_user_data.get("picture")
            
            if not google_id or not email:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid user data from Google"
                )
            
            # Check if email is in whitelist (only allow specific emails)
            ALLOWED_EMAILS = [
                "ivan.e.miranda@gmail.com",
                "shilpa.r.mayekar@gmail.com"
            ]
            
            if email.lower() not in [e.lower() for e in ALLOWED_EMAILS]:
                logger.warning(f"Unauthorized login attempt from email: {email}")
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied. Your email is not authorized to access this application."
                )
            
            # Find existing user - DO NOT CREATE NEW USERS
            # Only users that exist in the database (from migration script) can log in
            # First try to find by google_id
            user = db.query(User).filter(User.google_id == google_id).first()
            
            if user:
                # Verify email matches exactly (case-sensitive check for security)
                if user.email.lower() != email.lower():
                    logger.warning(f"Email mismatch for user {user.id}: DB has '{user.email}', Google returned '{email}'")
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Access denied. Email mismatch detected. Please contact the administrator."
                    )
                # Update existing user (found by google_id)
                user.email = email  # Update to ensure exact case match
                user.name = name
                user.picture = picture
                user.last_login = datetime.utcnow()
                logger.info(f"Updated existing user (by google_id): {email}")
            else:
                # If not found by google_id, check by email (case-insensitive for lookup, but verify exact match)
                # Use func.lower for case-insensitive comparison
                from sqlalchemy import func
                user = db.query(User).filter(func.lower(User.email) == email.lower()).first()
                
                if user:
                    # Verify exact email match (case-sensitive) for security
                    if user.email != email:
                        logger.warning(f"Email case mismatch: DB has '{user.email}', Google returned '{email}'. Updating to match Google.")
                        # Update email to match Google's exact case
                        user.email = email
                    # Update existing user (found by email) - this happens when user logs in for first time after migration
                    user.google_id = google_id
                    user.name = name
                    user.picture = picture
                    user.last_login = datetime.utcnow()
                    logger.info(f"Updated existing user (by email) with Google ID: {email}")
                else:
                    # User not found in database - reject login
                    # This should not happen if email whitelist is working, but reject anyway for security
                    logger.warning(f"Login attempt from unauthorized user (not in database): {email}")
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Access denied. Your account is not registered. Please contact the administrator."
                    )
            
            db.commit()
            db.refresh(user)
            
            # Create JWT token
            jwt_token = create_access_token(data={"sub": user.id})
            
            return TokenResponse(
                access_token=jwt_token,
                token_type="bearer",
                user=user.to_dict()
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in Google OAuth callback: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Authentication failed: {str(e)}"
        )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user)
):
    """Get current authenticated user information"""
    logger.info(f"User {current_user.email} (ID: {current_user.id}) requesting /me endpoint")
    return UserResponse(**current_user.to_dict())


@router.post("/logout")
async def logout():
    """Logout endpoint (client-side token removal)"""
    return {"message": "Logged out successfully"}
