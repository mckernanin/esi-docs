import { config } from "dotenv";
import express, { Application, Request, Response } from "express";
import got from "got";
import { v4 } from "uuid";
import * as qs from "query-string";
import { jwtVerify } from "jose/jwt/verify";
import { createRemoteJWKSet } from "jose/jwks/remote";

const app: Application = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const environment = {
  CLIENT_ID: config().parsed?.CLIENT_ID,
  CLIENT_SECRET: config().parsed?.CLIENT_SECRET,
  callbackUrl: "http://localhost:3000/api/auth/callback/eveonline",
};

// create base64'd credentials for auth header
const credentials = Buffer.from(
  `${environment.CLIENT_ID}:${environment.CLIENT_SECRET}`
).toString("base64");

app.get("/", (_req: Request, res: Response) =>
  res.send("<h1>Hello world!</h1>")
);

app.get("/auth", (_req: Request, res: Response) => {
  const params = {
    response_type: "code",
    redirect_uri: environment.callbackUrl,
    client_id: environment.CLIENT_ID,
    scope: "publicData",
    state: v4(),
  };
  res.redirect(
    `https://login.eveonline.com/v2/oauth/authorize/?${qs.stringify(params)}`
  );
});

app.get("/api/auth/callback/eveonline", async (req: Request, res: Response) => {
  try {
    // get token from CCP. got is just a request library
    const response = await got("https://login.eveonline.com/v2/oauth/token", {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Host: "login.eveonline.com",
      },
      method: "POST",
      form: {
        grant_type: "authorization_code",
        code: req.query.code,
      },
    });
    const body = JSON.parse(response.body);
    /**
     * using the jose npm library. the URL used here comes from the well-known endpoint they reference in docs
     *
     */
    const JWKS = createRemoteJWKSet(
      new URL("https://login.eveonline.com/oauth/jwks")
    );

    /**
     * jwtResult replaces the functionality of the old /verify endpoint, and gives you characterId, characterName, ownerHash, etc.
     */
    const jwtResult = await jwtVerify(body.access_token, JWKS);

    /**
     * This is how to get at the old data that was available from the verify endpoint
     */
    const character = {
      name: jwtResult.payload.name,
      owner: jwtResult.payload.owner,
      characterId: jwtResult.payload.sub?.split(":")[2],
    };

    res.json({
      token: { access: body.access_token, refresh: body.refresh_token },
      jwtResult,
      character,
      refreshUrl: `http://localhost:3000/api/auth/refresh?refresh_token=${encodeURIComponent(
        body.refresh_token
      )}`,
      revokeurl: `http://localhost:3000/api/auth/revoke?refresh_token=${encodeURIComponent(
        body.refresh_token
      )}`,
    });
  } catch (error) {
    console.log((error as any).response.body);
    res.send("ERROR. See dev console.");
  }
});

app.get("/api/auth/refresh", async (req: Request, res: Response) => {
  try {
    console.log({
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Host: "login.eveonline.com",
      },
      method: "POST",
      form: {
        grant_type: "refresh_token",
        refresh_token: req.query.refresh_token,
        scope: "publicData",
      },
    });
    const response = await got("https://login.eveonline.com/v2/oauth/token", {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Host: "login.eveonline.com",
      },
      method: "POST",
      form: {
        grant_type: "refresh_token",
        refresh_token: req.query.refresh_token,
        scope: "publicData",
      },
    });
    const body = JSON.parse(response.body);

    res.json(body);
  } catch (error) {
    console.log((error as any).response.body);
    res.send((error as any).response.body);
  }
});

app.get("/api/auth/revoke", async (req: Request, res: Response) => {
  try {
    const response = await got("https://login.eveonline.com/v2/oauth/revoke", {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Host: "login.eveonline.com",
      },
      method: "POST",
      form: {
        token_type_hint: "refresh_token",
        token: req.query.refresh_token,
      },
    });
    if (response.statusCode === 200) {
      res.send("Token revoked successfully");
    } else {
      res.send(`Status code: ${response.statusCode} received from ESI.`);
    }
  } catch (error) {
    console.log((error as any).response.body);
    res.send("ERROR. See dev console.");
  }
});

try {
  app.listen(port, (): void => {
    console.log(`Connected successfully on port ${port}`);
  });
} catch (error) {
  console.error(`Error occured: ${(error as Error).message}`);
}