#include <WiFi.h>
#include <HTTPClient.h>

/* ================= WIFI ================= */
const char* ssid = "Redmi Note 14 Pro";
const char* password = "yoga1234";

/* ================= FIREBASE ================= */
const char* firebaseHost =
"https://earth-quake-vibration-detector-default-rtdb.asia-southeast1.firebasedatabase.app";

/* ================= UART ================= */
#define RXD2 16
#define TXD2 17

String line = "";
int totalEventCount = 0;

/* ================= SETUP ================= */
void setup()
{
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, RXD2, TXD2);

  Serial.println("ESP32 Firebase Monitor Starting...");

  WiFi.begin(ssid, password);

  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connected");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
}

/* ================= LOOP ================= */
void loop()
{
  while (Serial2.available())
  {
    char c = Serial2.read();

    if (c == '\n')
    {
      line.trim();

      if (line.length() > 0)
      {
        Serial.print("Received from AVR: ");
        Serial.println(line);
        sendToFirebase(line);
      }

      line = "";
    }
    else if (c != '\r')
    {
      line += c;
    }
  }
}

/* ================= FIREBASE SEND ================= */
void sendToFirebase(String data)
{
  int comma = data.indexOf(',');

  if (comma < 0)
  {
    Serial.println("Invalid data format");
    return;
  }

  String vibStr = data.substring(0, comma);
  String rawStatus = data.substring(comma + 1);

  vibStr.trim();
  rawStatus.trim();

  int vib = vibStr.toInt();

  String currentLevel;
  String statusText;
  String vibrationText;
  int triggerCount5s = 0;

  if (vib < 300)
  {
    currentLevel = "SAFE";
    statusText = "NO VIBRATION";
    vibrationText = "SAFE";
    triggerCount5s = 0;
  }
  else if (vib < 600)
  {
    currentLevel = "MEDIUM";
    statusText = "MEDIUM VIBRATION";
    vibrationText = "MEDIUM";
    triggerCount5s = 1;
    totalEventCount++;
  }
  else if (vib < 800)
  {
    currentLevel = "HIGH";
    statusText = "HIGH VIBRATION";
    vibrationText = "HIGH";
    triggerCount5s = 1;
    totalEventCount++;
  }
  else
  {
    currentLevel = "ALERT";
    statusText = "EARTHQUAKE ALERT";
    vibrationText = "ALERT";
    triggerCount5s = 1;
    totalEventCount++;
  }

  unsigned long nowMs = millis();

  String liveJson = "{";
  liveJson += "\"device\":\"esp32_01\",";
  liveJson += "\"currentLevel\":\"" + currentLevel + "\",";
  liveJson += "\"status\":\"" + statusText + "\",";
  liveJson += "\"vibration\":\"" + vibrationText + "\",";
  liveJson += "\"vibrationValue\":" + String(vib) + ",";
  liveJson += "\"triggerCount5s\":" + String(triggerCount5s) + ",";
  liveJson += "\"totalEventCount\":" + String(totalEventCount) + ",";
  liveJson += "\"updatedAt\":\"Live\",";
  liveJson += "\"timestamp\":" + String(nowMs);
  liveJson += "}";

  String historyJson = "{";
  historyJson += "\"device\":\"esp32_01\",";
  historyJson += "\"level\":\"" + currentLevel + "\",";
  historyJson += "\"status\":\"" + statusText + "\",";
  historyJson += "\"vibration\":\"" + vibrationText + "\",";
  historyJson += "\"vibrationValue\":" + String(vib) + ",";
  historyJson += "\"triggerCount\":" + String(triggerCount5s) + ",";
  historyJson += "\"totalCount\":" + String(totalEventCount) + ",";
  historyJson += "\"timestamp\":" + String(nowMs);
  historyJson += "}";

  if (WiFi.status() == WL_CONNECTED)
  {
    HTTPClient http;

    String liveUrl = String(firebaseHost) + "/earthquake_monitor/live.json";
    http.begin(liveUrl);
    http.addHeader("Content-Type", "application/json");

    int liveCode = http.PUT(liveJson);

    Serial.print("Live Firebase response: ");
    Serial.println(liveCode);

    String liveResponse = http.getString();
    if (liveResponse.length() > 0)
    {
      Serial.println(liveResponse);
    }

    http.end();

    HTTPClient httpHistory;

    String historyUrl = String(firebaseHost) + "/earthquake_monitor/history.json";
    httpHistory.begin(historyUrl);
    httpHistory.addHeader("Content-Type", "application/json");

    int historyCode = httpHistory.POST(historyJson);

    Serial.print("History Firebase response: ");
    Serial.println(historyCode);

    String historyResponse = httpHistory.getString();
    if (historyResponse.length() > 0)
    {
      Serial.println(historyResponse);
    }

    httpHistory.end();
  }
  else
  {
    Serial.println("WiFi disconnected. Cannot send to Firebase.");
  }
}
