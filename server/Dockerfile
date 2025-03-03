FROM python:alpine

WORKDIR /app

COPY requirements.txt .

# Install build dependencies
RUN apk add --no-cache gcc musl-dev linux-headers python3-dev

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy app files
COPY . .

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]