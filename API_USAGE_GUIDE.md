# Ollama Tools API - Complete Usage Guide

## Base URL
```
http://localhost:3100
```

---

## 📡 ALL ENDPOINTS & HOW TO USE THEM

### 1. Health Check
**Purpose**: Verify the API is running

**Endpoint**: `GET /health`

**Example**:
```bash
curl http://localhost:3100/health
```

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2025-01-28T12:34:56.789Z"
}
```

---

### 2. Web Search
**Purpose**: Search the web using DuckDuckGo

**Endpoint**: `POST /api/search`

**Body Parameters**:
- `query` (required): Search term
- `num_results` (optional): Number of results (default: 5)

**Example - PowerShell**:
```powershell
$body = @{
    query = "best pizza recipe"
    num_results = 5
} | ConvertTo-Json

Invoke-RestMethod -Uri http://localhost:3100/api/search -Method POST -Body $body -ContentType "application/json"
```

**Example - curl**:
```bash
curl -X POST http://localhost:3100/api/search \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"how to make pasta\", \"num_results\": 3}"
```

**Example - JavaScript**:
```javascript
const response = await fetch('http://localhost:3100/api/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'ollama tutorial',
    num_results: 5
  })
});
const data = await response.json();
console.log(data.results);
```

**Example - Python**:
```python
import requests

response = requests.post('http://localhost:3100/api/search', json={
    'query': 'machine learning basics',
    'num_results': 5
})
results = response.json()
for result in results['results']:
    print(f"{result['title']}: {result['url']}")
```

**Response**:
```json
{
  "query": "best pizza recipe",
  "results": [
    {
      "title": "Easy Homemade Pizza Recipe",
      "snippet": "This is the best homemade pizza recipe...",
      "url": "https://example.com/pizza"
    }
  ],
  "count": 5,
  "timestamp": "2025-01-28T12:34:56.789Z"
}
```

---

### 3. Weather Information
**Purpose**: Get current weather and forecast for any location

**Endpoint**: `GET /api/weather/:location`

**Parameters**:
- `:location`: City name, city with state, or coordinates

**Example - PowerShell**:
```powershell
Invoke-RestMethod -Uri http://localhost:3100/api/weather/Miami
Invoke-RestMethod -Uri "http://localhost:3100/api/weather/Jacksonville,FL"
Invoke-RestMethod -Uri http://localhost:3100/api/weather/London
```

**Example - curl**:
```bash
curl http://localhost:3100/api/weather/Tokyo
curl http://localhost:3100/api/weather/New%20York
```

**Example - JavaScript**:
```javascript
const weather = await fetch('http://localhost:3100/api/weather/Chicago')
  .then(r => r.json());
console.log(`Temperature: ${weather.current.temp_f}°F`);
console.log(`Condition: ${weather.current.condition}`);
```

**Example - Python**:
```python
import requests

weather = requests.get('http://localhost:3100/api/weather/Paris').json()
print(f"Temperature: {weather['current']['temp_c']}°C")
print(f"Feels like: {weather['current']['feels_like_c']}°C")
print(f"Condition: {weather['current']['condition']}")
```

**Response**:
```json
{
  "location": {
    "name": "Miami",
    "country": "United States"
  },
  "current": {
    "temp_c": "24",
    "temp_f": "75",
    "feels_like_c": "26",
    "feels_like_f": "79",
    "condition": "Partly cloudy",
    "humidity": "65",
    "wind_mph": "10",
    "wind_kph": "16",
    "precipitation_mm": "0"
  },
  "forecast": {
    "max_temp_c": "28",
    "max_temp_f": "82",
    "min_temp_c": "20",
    "min_temp_f": "68",
    "sunrise": "07:05 AM",
    "sunset": "06:30 PM"
  },
  "timestamp": "2025-01-28T12:34:56.789Z"
}
```

---

### 4. Timezone Information
**Purpose**: Get timezone details for any location

**Endpoint**: `GET /api/timezone/:location`

**Parameters**:
- `:location`: Timezone identifier (e.g., America/New_York)

**Example - PowerShell**:
```powershell
Invoke-RestMethod -Uri http://localhost:3100/api/timezone/America/New_York
Invoke-RestMethod -Uri http://localhost:3100/api/timezone/Europe/London
```

**Example - curl**:
```bash
curl http://localhost:3100/api/timezone/Asia/Tokyo
curl http://localhost:3100/api/timezone/Australia/Sydney
```

**Example - JavaScript**:
```javascript
const tz = await fetch('http://localhost:3100/api/timezone/America/Chicago')
  .then(r => r.json());
console.log(`Current time: ${tz.datetime}`);
console.log(`UTC offset: ${tz.utc_offset}`);
```

**Response**:
```json
{
  "timezone": "America/New_York",
  "datetime": "2025-01-28T07:34:56.123456-05:00",
  "utc_offset": "-05:00",
  "day_of_week": 2,
  "day_of_year": 28,
  "week_number": 5,
  "timestamp": "2025-01-28T12:34:56.789Z"
}
```

---

### 5. List All Timezones
**Purpose**: Get a list of all available timezone identifiers

**Endpoint**: `GET /api/timezones`

**Example**:
```bash
curl http://localhost:3100/api/timezones
```

**Response**:
```json
{
  "timezones": [
    "Africa/Abidjan",
    "Africa/Accra",
    "America/New_York",
    "America/Chicago",
    "Asia/Tokyo",
    "Europe/London",
    "..."
  ]
}
```

---

### 6. Geocoding (Location to Coordinates)
**Purpose**: Convert a location name to latitude/longitude coordinates

**Endpoint**: `GET /api/geocode/:location`

**Parameters**:
- `:location`: Place name, address, or landmark

**Example - PowerShell**:
```powershell
Invoke-RestMethod -Uri "http://localhost:3100/api/geocode/Eiffel Tower"
Invoke-RestMethod -Uri "http://localhost:3100/api/geocode/1600 Pennsylvania Avenue"
```

**Example - curl**:
```bash
curl http://localhost:3100/api/geocode/Statue%20of%20Liberty
curl http://localhost:3100/api/geocode/Central%20Park
```

**Example - JavaScript**:
```javascript
const location = await fetch('http://localhost:3100/api/geocode/Golden Gate Bridge')
  .then(r => r.json());
console.log(`Lat: ${location.latitude}, Lon: ${location.longitude}`);
```

**Example - Python**:
```python
import requests

location = requests.get('http://localhost:3100/api/geocode/Big Ben').json()
print(f"Location: {location['location']}")
print(f"Coordinates: {location['latitude']}, {location['longitude']}")
```

**Response**:
```json
{
  "location": "Eiffel Tower, Paris, France",
  "latitude": 48.8584,
  "longitude": 2.2945,
  "type": "tourism",
  "importance": 0.8,
  "bounding_box": ["48.8574", "48.8594", "2.2935", "2.2955"],
  "timestamp": "2025-01-28T12:34:56.789Z"
}
```

---

### 7. Reverse Geocoding (Coordinates to Location)
**Purpose**: Convert latitude/longitude coordinates to a location name

**Endpoint**: `GET /api/reverse-geocode/:lat/:lon`

**Parameters**:
- `:lat`: Latitude
- `:lon`: Longitude

**Example - PowerShell**:
```powershell
Invoke-RestMethod -Uri http://localhost:3100/api/reverse-geocode/40.7128/-74.0060
```

**Example - curl**:
```bash
curl http://localhost:3100/api/reverse-geocode/51.5074/-0.1278
```

**Example - JavaScript**:
```javascript
const place = await fetch('http://localhost:3100/api/reverse-geocode/48.8584/2.2945')
  .then(r => r.json());
console.log(`Location: ${place.location}`);
```

**Response**:
```json
{
  "latitude": 40.7128,
  "longitude": -74.0060,
  "location": "New York, New York, United States",
  "address": {
    "city": "New York",
    "state": "New York",
    "country": "United States",
    "country_code": "us"
  },
  "timestamp": "2025-01-28T12:34:56.789Z"
}
```

---

### 8. IP Information Lookup
**Purpose**: Get detailed information about an IP address

**Endpoint**: `GET /api/ip/:ip` or `GET /api/ip` (for your own IP)

**Parameters**:
- `:ip` (optional): IP address to lookup. If omitted, returns your IP info

**Example - PowerShell**:
```powershell
# Look up your own IP
Invoke-RestMethod -Uri http://localhost:3100/api/ip

# Look up specific IP
Invoke-RestMethod -Uri http://localhost:3100/api/ip/8.8.8.8
```

**Example - curl**:
```bash
curl http://localhost:3100/api/ip
curl http://localhost:3100/api/ip/1.1.1.1
```

**Example - JavaScript**:
```javascript
const myIp = await fetch('http://localhost:3100/api/ip')
  .then(r => r.json());
console.log(`Your IP: ${myIp.ip}`);
console.log(`Location: ${myIp.city}, ${myIp.country}`);

const googleDns = await fetch('http://localhost:3100/api/ip/8.8.8.8')
  .then(r => r.json());
console.log(`ISP: ${googleDns.isp}`);
```

**Example - Python**:
```python
import requests

# Your IP
my_ip = requests.get('http://localhost:3100/api/ip').json()
print(f"Your IP: {my_ip['ip']}")
print(f"Location: {my_ip['city']}, {my_ip['country']}")

# Specific IP
ip_info = requests.get('http://localhost:3100/api/ip/8.8.8.8').json()
print(f"ISP: {ip_info['isp']}")
```

**Response**:
```json
{
  "ip": "8.8.8.8",
  "country": "United States",
  "country_code": "US",
  "region": "California",
  "city": "Mountain View",
  "zip": "94035",
  "latitude": 37.386,
  "longitude": -122.0838,
  "timezone": "America/Los_Angeles",
  "isp": "Google LLC",
  "org": "Google Public DNS",
  "as": "AS15169 Google LLC",
  "timestamp": "2025-01-28T12:34:56.789Z"
}
```

---

### 9. DNS Lookup
**Purpose**: Resolve a hostname to IP addresses (IPv4 and IPv6)

**Endpoint**: `GET /api/dns/:hostname`

**Parameters**:
- `:hostname`: Domain name to lookup

**Example - PowerShell**:
```powershell
Invoke-RestMethod -Uri http://localhost:3100/api/dns/google.com
Invoke-RestMethod -Uri http://localhost:3100/api/dns/github.com
```

**Example - curl**:
```bash
curl http://localhost:3100/api/dns/cloudflare.com
curl http://localhost:3100/api/dns/amazon.com
```

**Example - JavaScript**:
```javascript
const dns = await fetch('http://localhost:3100/api/dns/example.com')
  .then(r => r.json());
console.log(`IPv4 addresses: ${dns.ipv4.join(', ')}`);
```

**Example - Python**:
```python
import requests

dns = requests.get('http://localhost:3100/api/dns/github.com').json()
print(f"Hostname: {dns['hostname']}")
print(f"IPv4: {dns['ipv4']}")
print(f"IPv6: {dns['ipv6']}")
```

**Response**:
```json
{
  "hostname": "google.com",
  "ipv4": ["142.250.185.46"],
  "ipv6": ["2607:f8b0:4004:c07::71"],
  "timestamp": "2025-01-28T12:34:56.789Z"
}
```

---

### 10. Ping Test
**Purpose**: Test connectivity to a host

**Endpoint**: `GET /api/ping/:host`

**Parameters**:
- `:host`: Hostname or IP address to ping

**Example - PowerShell**:
```powershell
Invoke-RestMethod -Uri http://localhost:3100/api/ping/google.com
```

**Example - curl**:
```bash
curl http://localhost:3100/api/ping/8.8.8.8
curl http://localhost:3100/api/ping/github.com
```

**Example - JavaScript**:
```javascript
const ping = await fetch('http://localhost:3100/api/ping/cloudflare.com')
  .then(r => r.json());
console.log(`Host alive: ${ping.alive}`);
```

**Response**:
```json
{
  "host": "google.com",
  "alive": true,
  "output": [
    "Pinging google.com [142.250.185.46] with 32 bytes of data:",
    "Reply from 142.250.185.46: bytes=32 time=12ms TTL=117",
    "Reply from 142.250.185.46: bytes=32 time=11ms TTL=117",
    "..."
  ],
  "timestamp": "2025-01-28T12:34:56.789Z"
}
```

---

### 11. Current Time
**Purpose**: Get current time in various formats

**Endpoint**: `GET /api/time`

**Example - PowerShell**:
```powershell
Invoke-RestMethod -Uri http://localhost:3100/api/time
```

**Example - curl**:
```bash
curl http://localhost:3100/api/time
```

**Example - JavaScript**:
```javascript
const time = await fetch('http://localhost:3100/api/time')
  .then(r => r.json());
console.log(`UTC: ${time.utc}`);
console.log(`Unix timestamp: ${time.unix}`);
```

**Response**:
```json
{
  "utc": "2025-01-28T12:34:56.789Z",
  "unix": 1738069496,
  "local": "1/28/2025, 7:34:56 AM",
  "timestamp": "2025-01-28T12:34:56.789Z"
}
```

---

### 12. List All Endpoints
**Purpose**: Get a list of all available endpoints with descriptions

**Endpoint**: `GET /api/endpoints`

**Example**:
```bash
curl http://localhost:3100/api/endpoints
```

**Response**:
```json
{
  "endpoints": [
    {
      "method": "GET",
      "path": "/health",
      "description": "Health check"
    },
    {
      "method": "POST",
      "path": "/api/search",
      "description": "Web search",
      "body": {
        "query": "string",
        "num_results": "number (optional)"
      }
    },
    "..."
  ]
}
```

---

## 🤖 USING WITH OLLAMA

### Basic Integration Example

**JavaScript/Node.js**:
```javascript
const axios = require('axios');

async function askAIWithTools(question) {
  // Step 1: Get weather data from our API
  const weather = await axios.get('http://localhost:3100/api/weather/Miami');
  
  // Step 2: Ask Ollama with the context
  const prompt = `${question}\n\nCurrent weather data: ${JSON.stringify(weather.data)}`;
  
  const ollama = await axios.post('http://localhost:11434/api/generate', {
    model: 'qwen3:14b',
    prompt: prompt,
    stream: false
  });
  
  return ollama.data.response;
}

// Usage
askAIWithTools("Should I bring a jacket today?").then(console.log);
```

**Python**:
```python
import requests

def ask_ai_with_tools(question):
    # Get weather
    weather = requests.get('http://localhost:3100/api/weather/Miami').json()
    
    # Ask Ollama
    prompt = f"{question}\n\nWeather: {weather}"
    ollama = requests.post('http://localhost:11434/api/generate', json={
        'model': 'qwen3:14b',
        'prompt': prompt,
        'stream': False
    })
    
    return ollama.json()['response']

# Usage
print(ask_ai_with_tools("What's the weather like?"))
```

---

## 💡 PRACTICAL USE CASES

### 1. Weather Bot
```javascript
// Discord bot that checks weather
client.on('messageCreate', async (message) => {
  if (message.content.startsWith('!weather')) {
    const city = message.content.split(' ')[1];
    const weather = await fetch(`http://localhost:3100/api/weather/${city}`)
      .then(r => r.json());
    
    message.reply(`🌤️ ${weather.current.temp_f}°F in ${city}`);
  }
});
```

### 2. Location Tracker
```python
# Track and log IP locations
import requests

def track_visitor(ip):
    info = requests.get(f'http://localhost:3100/api/ip/{ip}').json()
    print(f"Visitor from {info['city']}, {info['country']}")
    return info
```

### 3. Smart Search Assistant
```javascript
// AI that searches and summarizes
async function smartSearch(query) {
  const results = await fetch('http://localhost:3100/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, num_results: 5 })
  }).then(r => r.json());
  
  // Feed to Ollama for summary
  const summary = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3:14b',
      prompt: `Summarize these search results: ${JSON.stringify(results)}`,
      stream: false
    })
  }).then(r => r.json());
  
  return summary.response;
}
```

---

## 🔧 ERROR HANDLING

All endpoints return appropriate HTTP status codes:
- `200`: Success
- `400`: Bad request (missing parameters)
- `404`: Not found
- `500`: Server error

**Example Error Response**:
```json
{
  "error": "Weather lookup failed",
  "details": "Invalid location"
}
```

**Handle Errors in JavaScript**:
```javascript
try {
  const weather = await fetch('http://localhost:3100/api/weather/InvalidCity')
    .then(r => r.json());
  console.log(weather);
} catch (error) {
  console.error('API Error:', error);
}
```

**Handle Errors in Python**:
```python
try:
    response = requests.get('http://localhost:3100/api/weather/InvalidCity')
    response.raise_for_status()  # Raises exception for 4xx/5xx
    data = response.json()
except requests.exceptions.HTTPError as e:
    print(f"Error: {e}")
```

---

## 📝 NOTES

1. **No API Keys Required**: All services use free APIs
2. **Rate Limits**: Some external services have rate limits
3. **CORS**: Not enabled by default (add if needed for browser use)
4. **Encoding**: Use URL encoding for special characters (spaces = %20)
5. **Timeouts**: Network operations have 10-second timeout

---

**API Base URL**: `http://localhost:3100`  
**Default Port**: `3100`  
**Supports**: GET and POST requests  
**Response Format**: JSON
