import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import type { Config } from "../config.js";
import type { PublisherLike } from "./listings.js";

export const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

export function createPublisher(config: Pick<Config, "keyFile">): PublisherLike {
  const auth = new GoogleAuth({ keyFile: config.keyFile, scopes: [ANDROID_PUBLISHER_SCOPE] });
  const client = google.androidpublisher({ version: "v3", auth });
  return client as unknown as PublisherLike;
}
