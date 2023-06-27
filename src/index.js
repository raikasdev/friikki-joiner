const express = require("express");
const axios = require("axios");
const cookieParser = require("cookie-parser");
const app = express();

// .env -> process.env.
require("dotenv").config();

// Serve /public (index.html)
app.use(express.static("./public"));
app.use(cookieParser()); // Cookies are used for saving consent before and after OAuth

// Config
const githubClientId = process.env.CLIENT_ID;
const githubClientSecret = process.env.CLIENT_SECRET;
const githubRedirect = process.env.REDIRECT_URI;
const githubAccessToken = process.env.ACCESS_TOKEN; // Personal Access Token of an admin
const organizationName = process.env.ORGANIZATION_NAME || "ohjelmistofriikit";

// Redirect user to github
app.get("/join", (req, res) => {
  res.cookie("allowPublic", req.query.consentPublic || "off");
  res.redirect(
    `https://github.com/login/oauth/authorize?client_id=${githubClientId}&redirect_uri=${githubRedirect}&scope=write:org`
  );
});

// Process authorized
app.get("/authorized", async (req, res) => {
  if (!req.query.code)
    return res
      .status(400)
      .send("Github authorization failed, no OAuth code was returned.");

  // Forming an URL string for Github API
  const parameters = new URLSearchParams();
  parameters.append("code", req.query.code);
  parameters.append("redirect_url", githubRedirect);
  parameters.append("client_id", githubClientId);
  parameters.append("client_secret", githubClientSecret);

  let accessToken;
  try {
    const response = await axios.post(
      `https://github.com/login/oauth/access_token?${parameters.toString()}`
    );
    const responseParams = new URLSearchParams(response.data);
    if (responseParams.get("error"))
      return res
        .status(500)
        .send(
          `Failed to get access token due to "${responseParams.get(
            "error_description"
          )}"`
        );
    accessToken = responseParams.get("access_token");
  } catch (e) {
    return res.status(500).send("Failed to get access token from Github API");
  }

  // Now that we have the access token, let's get the user id so we can invite the user

  let userId;
  let username;

  try {
    const userRes = await axios.get("https://api.github.com/user", {
      headers: {
        Authorization: `Token ${accessToken}`,
      },
    });
    userId = userRes.data.id;
    username = userRes.data.login;
  } catch (e) {
    return res.status(500).send("Failed to fetch user profile");
  }

  // Invite!
  try {
    await axios.post(
      `https://api.github.com/orgs/${organizationName}/invitations`,
      {
        invitee_id: userId,
      },
      {
        headers: {
          Authorization: `Token ${githubAccessToken}`,
        },
      }
    );
  } catch (e) {
    if (
      e.response?.data?.errors[0]?.message ===
      "Invitee is already a part of this org"
    ) {
      // User is part of org, redirect
      res.redirect(`https://github.com/${organizationName}`);
      return;
    }
    return res.status(500).send("Failed to invite user to organization");
  }

  try {
    // Now let's accept the invite
    await axios.patch(
      `https://api.github.com/user/memberships/orgs/${organizationName}`,
      {
        accept: "application/vnd.github.v3+json",
        state: "active",
      },
      {
        headers: {
          Authorization: `Token ${accessToken}`,
        },
      }
    );
  } catch (e) {
    return res
      .status(500)
      .send(
        "Accepting invite failed, please accept it manually from your email."
      );
  }

  // Setting membership to publish, if allowed
  if (req.cookies.allowPublic === "on") {
    try {
      await axios.put(
        `https://api.github.com/orgs/${organizationName}/public_members/${username}`,
        {},
        {
          headers: {
            Authorization: `Token ${accessToken}`,
          },
        }
      );
    } catch (e) {
      console.log("Publicizing membership failed."); // Just sucking it up, not worth showing error messages anymore
    }
  }

  res.redirect(`https://github.com/${organizationName}`);
});

app.listen(process.env.PORT || 8080, () => {
  console.log(`Running on :${process.env.PORT || 8080}`);
});
