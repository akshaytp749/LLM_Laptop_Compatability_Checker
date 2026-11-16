FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Bind all interfaces INSIDE the container; docker-compose publishes the port
# on 127.0.0.1 only, so the API is still not reachable from the LAN.
ENV HOST=0.0.0.0
EXPOSE 5000

CMD ["python", "app.py"]
