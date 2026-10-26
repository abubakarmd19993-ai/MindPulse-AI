
import pandas as pd
import joblib

from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.ensemble import RandomForestRegressor

# 1. Load the dataset
df = pd.read_csv("Student Social Media And Mental Health Impact (1).csv")

# 2. Separate inputs and target
target = "Mental_Health_Score"

X = df.drop(columns=[target])
y = df[target]

# 3. Identify categorical and numerical columns
categorical_cols = X.select_dtypes(
    include=["object", "category"]
).columns.tolist()

numerical_cols = X.select_dtypes(
    include=["number"]
).columns.tolist()

# 4. Preprocess numerical data
numerical_pipeline = Pipeline([
    ("imputer", SimpleImputer(strategy="median")),
    ("scaler", StandardScaler())
])

# 5. Preprocess categorical data
categorical_pipeline = Pipeline([
    ("imputer", SimpleImputer(strategy="most_frequent")),
    ("encoder", OneHotEncoder(handle_unknown="ignore"))
])

preprocessor = ColumnTransformer([
    ("num", numerical_pipeline, numerical_cols),
    ("cat", categorical_pipeline, categorical_cols)
])

# 6. Build the model
model = Pipeline([
    ("preprocessor", preprocessor),
    ("regressor", RandomForestRegressor(
        n_estimators=200,
        random_state=42
    ))
])

# 7. Train and evaluate
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

model.fit(X_train, y_train)

print("R2 score:", round(model.score(X_test, y_test), 4))
print("Input columns:", list(model.feature_names_in_))
print("Number of input columns:", len(model.feature_names_in_))

# 8. Save the corrected model
joblib.dump(model, "Mental_Health_Model.pkl")

print("Corrected model saved successfully!")
