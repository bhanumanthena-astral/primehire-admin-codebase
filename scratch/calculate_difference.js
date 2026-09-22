const pairs = [
  { intId: "16d3db65e814ccb8416d040a02deb64035b8ddb4", resId: "16d53ef899660bbb1a4617e193420506384061c2" },
  { intId: "16824eca0374ed2e017fcb371b78533f50fbbcf2", resId: "1684ead6accfb3bc9bfc3b17f38bc91340c15288" },
  { intId: "16824edd95898b033d28e8504db68eb7efe0797b", resId: "1684eaa6a5912cdaec829a305092e8b040cee779" }
];

for (const { intId, resId } of pairs) {
  const intVal = BigInt("0x" + intId);
  const resVal = BigInt("0x" + resId);
  const diffVal = resVal - intVal;
  console.log(`Difference (resId - intId): ${diffVal.toString(16)} (hex) / ${diffVal.toString()} (dec)`);
}
