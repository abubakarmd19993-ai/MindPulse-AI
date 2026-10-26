
from pathlib import Path
from typing import Literal

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware


# --------------------------------------------------
# Configuration
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "Mental_Health_Model.pkl"

TARGET_COLUMN = "Mental_Health_Score"

FEATURE_COLUMNS = [
    "Age",
    "Gender",
    "Country",
    "Academic_Level",
    "Most_Used_Platform",
    "Purpose_Of_Use",
    "Avg_Daily_Usage_Hours",
    "Daily_Unlocks",
    "Study_Hours",
    "Physical_Activity_Hours",
    "Sleep_Hours_Per_Night",
    "Stress_Level",
]


# --------------------------------------------------
# Load and validate model
# --------------------------------------------------

if not MODEL_PATH.exists():
    raise FileNotFoundError(
        f"Model file not found: {MODEL_PATH}. "
        "Run retrain_model.py first."
    )

model = joblib.load(MODEL_PATH)

expected_columns = getattr(model, "feature_names_in_", None)

if expected_columns is not None:
    expected_columns = list(expected_columns)

    if TARGET_COLUMN in expected_columns:
        raise RuntimeError(
            f"The saved model includes '{TARGET_COLUMN}' "
            "as an input feature. Retrain the model."
        )

    missing_columns = set(FEATURE_COLUMNS) - set(expected_columns)
    extra_columns = set(expected_columns) - set(FEATURE_COLUMNS)

    if missing_columns or extra_columns:
        raise RuntimeError(
            "Model/API feature mismatch.\n"
            f"Missing from model: {sorted(missing_columns)}\n"
            f"Extra model columns: {sorted(extra_columns)}"
        )

    if expected_columns != FEATURE_COLUMNS:
        raise RuntimeError(
            "Model input column order differs from the API. "
            "Check the training script and FEATURE_COLUMNS."
        )


# --------------------------------------------------
# FastAPI application
# --------------------------------------------------

app = FastAPI(
    title="Mental Health Score Prediction API",
    description=(
        "Predicts a mental health score from lifestyle "
        "and social media usage data."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:5501",
        "http://localhost:5501",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# Request schema
# --------------------------------------------------

class StudentData(BaseModel):
    age: int = Field(..., ge=10, le=100)

    gender: Literal["Male", "Female"]

    country: str = Field(..., min_length=1)

    academic_level: Literal[
        "Undergraduate",
        "Graduate",
        "High School",
    ]

    most_used_platform: Literal[
        "Facebook",
        "LinkedIn",
        "Instagram",
        "Snapchat",
        "Twitter",
        "YouTube",
        "TikTok",
        "LINE",
        "KakaoTalk",
        "VKontakte",
        "WhatsApp",
        "WeChat",
    ]

    purpose_of_use: Literal[
        "Networking",
        "Education",
        "Entertainment",
        "News",
    ]

    avg_daily_usage_hours: float = Field(..., ge=0, le=24)
    daily_unlocks: int = Field(..., ge=0)
    study_hours: float = Field(..., ge=0, le=24)
    physical_activity_hours: float = Field(..., ge=0, le=24)
    sleep_hours_per_night: float = Field(..., ge=0, le=24)

    stress_level: Literal[
        "Medium",
        "Low",
        "Very High",
        "High",
    ]


class PredictionResponse(BaseModel):
    predicted_mental_health_score: float


# --------------------------------------------------
# Routes
# --------------------------------------------------

@app.get("/")
def greet():
    return {
        "message": "Welcome to Mental Health Score Prediction API",
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "input_features": len(FEATURE_COLUMNS),
    }


@app.post("/predict", response_model=PredictionResponse)
def predict(data: StudentData):

    country = data.country.strip()

    if not country:
        raise HTTPException(
            status_code=422,
            detail="Country cannot be empty.",
        )

    # Match the feature columns used during model training.
    input_row = pd.DataFrame(
        [
            {
                "Age": data.age,
                "Gender": data.gender,
                "Country": country,
                "Academic_Level": data.academic_level,
                "Most_Used_Platform": data.most_used_platform,
                "Purpose_Of_Use": data.purpose_of_use,
                "Avg_Daily_Usage_Hours": data.avg_daily_usage_hours,
                "Daily_Unlocks": data.daily_unlocks,
                "Study_Hours": data.study_hours,
                "Physical_Activity_Hours": data.physical_activity_hours,
                "Sleep_Hours_Per_Night": data.sleep_hours_per_night,
                "Stress_Level": data.stress_level,
            }
        ],
        columns=FEATURE_COLUMNS,
    )

    try:
        prediction = model.predict(input_row)
        score = float(prediction[0])

        if not pd.notna(score):
            raise ValueError(
                "The model returned an invalid prediction."
            )

        return PredictionResponse(
            predicted_mental_health_score=round(score, 2)
        )

    except Exception as exc:
        print(
            f"Prediction error: {type(exc).__name__}: {exc}"
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Prediction failed. Check the backend terminal "
                "for the error details."
            ),
        ) from exc
