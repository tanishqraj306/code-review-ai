
FROM python:3.14-slim

RUN apt-get update && apt-get install -y git clang-tidy

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "-u", "worker.py"]
