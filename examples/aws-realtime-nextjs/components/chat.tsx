"use client";

import mqtt from "mqtt";
import { useState, useEffect } from "react";
import styles from "./chat.module.css";

function createConnection(endpoint: string, authorizer: string) {
  return mqtt.connect(`wss://${endpoint}/mqtt?x-amz-customauthorizer-name=${authorizer}`, {
    protocolVersion: 5,
    manualConnect: true,
    username: "", // Must be empty for the authorizer
    password: "PLACEHOLDER_TOKEN", // Passed as the token to the authorizer
    clientId: `client_${window.crypto.randomUUID()}`,
  });
}

export default function Chat(
  { topic, endpoint, authorizer }: { topic: string, endpoint: string, authorizer: string }
) {
  const [messages, setMessages] = useState<string[]>([]);
  const [connection, setConnection] = useState<mqtt.MqttClient | null>(null);

  useEffect(() => {
    const connection = createConnection(endpoint, authorizer);

    connection.on("connect", async () => {
      try {
        await connection.subscribeAsync(topic, { qos: 1 });
        setConnection(connection);
      } catch (e) { }
    });
    connection.on("message", (_fullTopic, payload) => {
      const message = new TextDecoder("utf8").decode(new Uint8Array(payload));
      setMessages((prev) => [...prev, message]);
    });
    connection.on("error", console.error);

    connection.connect();

    return () => {
      connection.end();
      setConnection(null);
    };
  }, [topic, endpoint, authorizer]);

  return (
    <div className={styles.chat}>
      {connection && messages.length > 0 &&
        <div className={styles.messages}>
          {messages.map((msg, i) => (
            <div key={i}>{JSON.parse(msg).message}</div>
          ))}
        </div>
      }
      <form
        className={styles.form}
        onSubmit={async (e) => {
          e.preventDefault();

          const input = (e.target as HTMLFormElement).message;

          connection!.publish(topic, JSON.stringify({ message: input.value }), { qos: 1 });
          input.value = "";
        }}
      >
        <input
          required
          autoFocus
          type="text"
          name="message"
          placeholder={
            connection ? "Ready! Say hello..." : "Connecting..."
          }
        />
        <button type="submit" disabled={connection === null}>Send</button>
      </form>
    </div>
  );
}
