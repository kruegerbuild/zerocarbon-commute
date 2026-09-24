// api/attest.js: Vercel serverless function (becomes POST /api/attest)
// Signs a trip attestation with the verifier key so the contract will mint $GREEN.
//
// Environment variables (Vercel -> Project -> Settings -> Environment Variables):
//   VERIFIER_PRIVATE_KEY  private key of the DEDICATED verifier wallet (0x...)
//   CONTRACT_ADDRESS      deployed ZeroCarbonCommute address on the network you're targeting
//   CHAIN_ID              chain ID of that network (number, e.g. 12345)
//
// Switching testnet -> mainnet later = change CONTRACT_ADDRESS and CHAIN_ID, then redeploy.

const { ethers } = require("ethers");

// Mirrors the contract's limits so we never sign a trip the contract would reject
const MAX_SPEED_KMH = 25;
const MAX_TRIP_DISTANCE_KM = 100;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { VERIFIER_PRIVATE_KEY, CONTRACT_ADDRESS, CHAIN_ID } = process.env;
  if (!VERIFIER_PRIVATE_KEY || !CONTRACT_ADDRESS || !CHAIN_ID) {
    return res.status(500).json({ error: "Server not configured (missing environment variables)" });
  }

  try {
    const expectedChainId = Number(CHAIN_ID);
    const { user, tripId, distanceMeters, durationSeconds, routeHash, chainId } = req.body || {};

    // --- Input validation ---
    if (!ethers.utils.isAddress(user)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    if (!ethers.utils.isHexString(tripId, 32) || !ethers.utils.isHexString(routeHash, 32)) {
      return res.status(400).json({ error: "Invalid tripId or routeHash" });
    }
    if (chainId !== expectedChainId) {
      return res.status(400).json({ error: "Wrong network (expected chain ID " + expectedChainId + ")" });
    }
    if (
      !Number.isInteger(distanceMeters) || !Number.isInteger(durationSeconds) ||
      distanceMeters <= 0 || durationSeconds <= 0
    ) {
      return res.status(400).json({ error: "Invalid distance or duration" });
    }
    if (Math.floor(distanceMeters / 1000) > MAX_TRIP_DISTANCE_KM) {
      return res.status(400).json({ error: "Trip distance exceeds " + MAX_TRIP_DISTANCE_KM + " km cap" });
    }
    const avgSpeedKmh = Math.floor((distanceMeters * 3600) / (durationSeconds * 1000));
    if (avgSpeedKmh > MAX_SPEED_KMH) {
      return res.status(400).json({ error: "Speed exceeds " + MAX_SPEED_KMH + " km/h threshold" });
    }

    // TODO (before mainnet): verify the trip against real GPS telemetry before signing.

    // --- Sign: field order MUST match the contract's abi.encodePacked(...) ---
    const hash = ethers.utils.solidityKeccak256(
      ["address", "address", "bytes32", "uint256", "uint256", "bytes32", "uint256"],
      [user, CONTRACT_ADDRESS, tripId, distanceMeters, durationSeconds, routeHash, expectedChainId]
    );
    const wallet = new ethers.Wallet(VERIFIER_PRIVATE_KEY);
    const signature = await wallet.signMessage(ethers.utils.arrayify(hash));

    return res.status(200).json({ signature, signer: wallet.address });
  } catch (err) {
    console.error("attest error:", err);
    return res.status(500).json({ error: "Verifier service error" });
  }
};
