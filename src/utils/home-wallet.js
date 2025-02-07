import axios from "axios";
import BigNumber from "bignumber.js";
import coingecko from "./coingecko";
import ipfs from "./ipfs";
import teztools from "./teztools";
import knownContracts from "../knownContracts.json";
// const makeReqest = async ({ contract, id }) => {
//   return axios.get(`${process.env.VUE_APP_TEZTOOLS_API_URL}/token/${contract}${id ? "_" + id : ""}/price`);
// };
const getTokenId = (priceObj, token) => {
  if (priceObj) {
    if (priceObj.tokenId !== undefined) {
      return priceObj.tokenId;
    }
    if (priceObj.type !== undefined) {
      return 0;
    }
  }
  if (token) {
    if (token.tokenId !== undefined) {
      return token.tokenId;
    }
  }
  return undefined;
};

const generateObjktQuery = (contractList) => {
  return `
    query contracts {
      fa(where: {contract: {_in: ${contractList}}}) {
        collection_id
        contract
        description
        editions
        logo
        metadata
        name
        collection_type
      }
    }
  `;
};

const getOBJKTCollections = async (contractList) => {
  const query = generateObjktQuery(JSON.stringify(contractList));
  const response = await axios.post("https://data.objkt.com/v2/graphql", {
    query,
  });

  return response.data.data.fa;
};

function getImgUri(uri, collection) {
  if (!uri) {
    return "https://res.cloudinary.com/melvin-manni/image/upload/v1660322565/fgpwgssbhq2bfmsjerur.png";
  }
  if (uri.startsWith("ipfs")) {
    return uri.replace("ipfs://", "https://cloudflare-ipfs.com/ipfs/");
  } else {
    return uri;
  }
}

function getObjktLink(token) {
  return `https://objkt.com/asset/${token.contract.address}/${token.tokenId}`;
}

export default {
  async fetchNFts(pkh) {
    const { data: balances } = await axios.get(
      `https://api.tzkt.io/v1/tokens/balances?account=${pkh}&balance.gt=0&limit=10000&select=token,balance`
    );
    const isToken = (val) => {
      return (
        !val.token?.metadata?.artifactUri &&
        (val?.token?.metadata?.symbol || val?.token?.contract?.alias) &&
        !val.toke?.metadata?.formats
      );
    };
    const groupedNFTs = {};

    balances.forEach((val) => {
      if (!isToken(val)) {
        const contractAddress = val.token.contract.address;
        if (groupedNFTs[contractAddress] !== undefined) {
          groupedNFTs[contractAddress].push(val);
        } else {
          groupedNFTs[contractAddress] = [val];
        }
      }
    });

    const populateKnownCollectionFields = (collection, found) => {
      const toRet = { ...collection };
      toRet.thumbnailUri = found.thumbnailUrl;
      toRet.art = found.thumbnailUrl || found.discoverUrl;
      toRet.name = found.name;
      return toRet;
    };

    const populateObjktData = (collection, data) => {
      collection.name = data.name;
      collection.art = getImgUri(data.logo, true);
    };

    const buildNFTData = (nfts) => {
      const toRet = [];

      nfts.forEach((nft) => {
        const metadata = nft.token.metadata;
        if (metadata) {
          const imgURI = metadata.displayUri || metadata.thumbnailUri || "";
          const contractDetails = nft.token.contract;
          toRet.push({
            collectionName:
              contractDetails?.alias || contractDetails?.address || "",
            name: metadata.name,
            art: getImgUri(imgURI),
            objkLink: getObjktLink(nft.token),
            links: [
              {
                name: "OBJKT",
                icon: "https://tezos.art/objkt.png",
                url: getObjktLink(nft.token),
              },
            ],
          });
        }
      });
      return toRet;
    };
    const unknownCollections = [];
    const collections = Object.keys(groupedNFTs).map((k) => {
      try {
        let collection = {
          address: k,
          thumbnailUri:
            "https://res.cloudinary.com/melvin-manni/image/upload/v1660322565/fgpwgssbhq2bfmsjerur.png",
          art: "https://res.cloudinary.com/melvin-manni/image/upload/v1660322565/fgpwgssbhq2bfmsjerur.png",
          items: [],
          name: "",
        };
        const found = knownContracts.find((kc) => kc.address.includes(k));

        if (found) {
          collection = populateKnownCollectionFields(collection, found);
        } else {
          unknownCollections.push(k);
        }
        collection.items = buildNFTData(groupedNFTs[k]);
        return collection;
      } catch (e) {
        console.log("error building group", groupedNFTs[k]);
        console.log(e);
      }
    });
    if (unknownCollections.length > 0) {
      const objktData = await getOBJKTCollections(unknownCollections);
      objktData.forEach((d) => {
        const collection = collections.find((c) => c.address === d.contract);
        populateObjktData(collection, d);
      });
    }
    const stillMissingArt = collections.filter((c) => c.art === undefined);
    stillMissingArt.forEach((col) => {
      col.name = col.items[0]?.collectionName;
      col.art = col.items[0]?.art;
    });
    return {
      collections: collections
        .filter((c) => c.items.length > 0)
        .sort((a, b) => b.items.length - a.items.length),
    };
  },
  async getNftCollectionData(nfts, address) {
    return nfts.find((nft) => nft.address === address);
  },

  async fetchAssetsBal(pkh) {
    // return array for token balances and filtered data

    const assets = [];
    try {
      // Fetch all token balance linked to an address
      let { data: balances } = await axios.get(
        `https://api.tzkt.io/v1/tokens/balances?account=${pkh}&balance.gt=0&limit=10000&select=token,balance`
      );

      // Fetch the currrent price of xtz in USD to multiply the price of tokens
      const usdMul = await coingecko.getXtzUsdPrice();

      // Check if address has CRUNCH token , if the address doesnot, i will append the token data
      if (
        balances.filter(
          (val) =>
            val.token?.contract?.address ===
            process.env.VUE_APP_CONTRACTS_CRUNCH
        ).length < 1
      ) {
        balances.push({
          token: {
            token_id: 0,
            tokenId: 0,
            contract: { address: process.env.VUE_APP_CONTRACTS_CRUNCH },
            metadata: {
              thumbnail_uri:
                "https://ipfs.fleek.co/ipfs/bafybeienhhbxz53n3gtg7stjou2zs3lmhupahwovv2kxwh5uass3bc5xzq",
              symbol: "CRUNCH",
              decimals: 8,
            },
          },
          balance: new BigNumber(0),
        });
      }

      // Check if address has crDAO token , if the address doesnot, i will append the token data
      if (
        balances.filter(
          (val) =>
            val.token?.contract?.address === process.env.VUE_APP_CONTRACTS_CRDAO
        ).length < 1
      ) {
        balances.push({
          token: {
            contract: { address: process.env.VUE_APP_CONTRACTS_CRDAO },
            token_id: 0,
            tokenId: 0,
            name: "Crunchy DAO",
            metadata: {
              thumbnail_uri:
                "https://ipfs.fleek.co/ipfs/bafybeigulbzm5x72qtmckxqvd3ksk6q3vlklxjgpnvvnbcofgdp6qwu43u",
              symbol: "crDAO",
              decimals: 8,
            },
          },
          balance: new BigNumber(0),
        });
      }

      // Get all wallet prices
      const { contracts: prices } = await teztools.getPricefeed();

      // filter out NFTs by checking for artifactURI and token symbol or alias
      const tokens = [];

      const isToken = (val) => {
        return (
          !val.token?.metadata?.artifactUri &&
          (val?.token?.metadata?.symbol || val?.token?.contract?.alias) &&
          !val.toke?.metadata?.formats
        );
      };

      balances.forEach((val) => {
        if (isToken(val)) {
          tokens.push(val);
        }
      });
      balances = tokens;
      // map through all the balances to sort data
      for (let i = 0; i < balances.length; i++) {
        let priceFilter = prices.filter(
          (val) => val.tokenAddress === balances[i]?.token?.contract?.address
        );

        if (priceFilter.length > 1) {
          if (balances[i]?.token?.metadata !== undefined) {
            priceFilter = priceFilter.filter(
              (val) => val.symbol === balances[i]?.token?.metadata?.symbol
            );
          } else if (balances[i]?.token?.tokenId !== undefined) {
            priceFilter = priceFilter.filter(
              (val) => val.tokenId.toString() === balances[i].token.tokenId
            );
          }
        }

        const priceObj = priceFilter.length ? priceFilter[0] : undefined;

        // get current price of token
        const currentPrice = priceObj?.currentPrice || false;
        const tokenid = getTokenId(priceObj, balances[i].token);
        // get token uri from prices :: This is because  balance does not return  some tokens thumbnail
        const thumbnailUri = priceObj?.thumbnailUri || false;

        const decimals = priceObj?.decimals || false;

        // Data filter and calculations
        const bal = new BigNumber(balances[i]?.balance);
        const balance = bal.div(
          new BigNumber(10).pow(
            balances[i]?.token?.metadata?.decimals ||
              decimals ||
              (balances[i]?.token?.standard !== "fa1.2" ? 6 : 3)
          )
        );

        const price = new BigNumber(currentPrice);
        const priceUsd = new BigNumber(currentPrice).multipliedBy(
          new BigNumber(usdMul)
        );
        const value = balance.multipliedBy(price);
        const valueUsd = balance.multipliedBy(priceUsd);
        const icon = ipfs.transformUri(
          balances[i]?.token?.metadata?.thumbnailUri || thumbnailUri || ""
        );
        const pricePair = priceObj?.pairs.find(
          (el) => el.dex === "Quipuswap" && el.sides[1].symbol === "XTZ"
        );
        var assetSlug;
        if (tokenid !== undefined) {
          assetSlug = `${balances[i]?.token?.contract?.address}_${tokenid}`;
        } else {
          assetSlug = balances[i]?.token?.contract?.address;
        }
        const valObj = {
          asset:
            priceObj?.symbol ||
            balances[i]?.token?.metadata?.symbol ||
            balances[i]?.token?.contract?.alias,
          icon,
          balance: balance.toNumber(),
          price: price.toNumber(),
          name: priceObj?.name,
          priceChange1Day: price
            .minus(pricePair?.sides[0]?.dayClose)
            .div(pricePair?.sides[0]?.dayClose)
            .times(100)
            .toNumber(),
          priceChange7Day: price
            .minus(pricePair?.sides[0]?.weekClose)
            .div(pricePair?.sides[0]?.weekClose)
            .times(100)
            .toNumber(),
          priceChange30Day: price
            .minus(pricePair?.sides[0]?.monthClose)
            .div(pricePair?.sides[0]?.monthClose)
            .times(100)
            .toNumber(),
          priceUsd: priceUsd.toNumber(),
          valueUsd: valueUsd.toNumber(),
          value: value.toNumber(),
          contract: balances[i]?.token?.contract?.address,
          tokenid,
          assetSlug,
          decimals: balances[i]?.token?.metadata?.decimals,
        };
        if (currentPrice) {
          assets.push(valObj);
        }
      }
      const { data: xtzBal } = await axios.get(
        `https://staging.api.tzkt.io/v1/accounts/${pkh}/balance`
      );

      const balance = new BigNumber(xtzBal).div(new BigNumber(10).pow(6));
      const value = balance.multipliedBy(usdMul);
      // const value = balance.multipliedBy(usdMul);

      assets
        .sort((a, b) => b.value - a.value)
        .unshift({
          asset: "XTZ",
          priceUsd: new BigNumber(usdMul).toNumber(),
          price: balance.toNumber(),
          icon: "data:image/png;base64,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",
          balance: balance.toNumber(),
          contract: "tez",
          name: "tez",
          value: balance.toNumber(),
          valueUsd: value.toNumber(),
          assetSlug: "tez",
          decimals: 6,
        });
    } catch (e) {
      console.log("/utils/home-wallet", e);
    }
    return { assets };
  },

  handleChrunchBal(arr) {
    return arr.filter(
      (val) => val.contract === process.env.VUE_APP_CONTRACTS_CRUNCH
    ).length > 0
      ? arr.filter(
          (val) => val.contract === process.env.VUE_APP_CONTRACTS_CRUNCH
        )[0].balance
      : 0;
  },

  handleCrDAOBal(arr) {
    return arr.filter(
      (val) => val.contract === process.env.VUE_APP_CONTRACTS_CRDAO
    ).length > 0
      ? arr.filter(
          (val) => val.contract === process.env.VUE_APP_CONTRACTS_CRDAO
        )[0].balance
      : 0;
  },

  calcNetworth(arr = []) {
    var sum = 0;

    for (let i = 0; i < arr.length; i++) {
      if (arr[i].value && !Number.isNaN(arr[i].value)) {
        sum = sum + arr[i].value;
      }
    }
    return sum;
  },

  calcUsdNetworth(arr = []) {
    var sum = 0;

    for (let i = 0; i < arr.length; i++) {
      if (arr[i].value && !Number.isNaN(arr[i].valueUsd)) {
        sum = sum + arr[i].valueUsd;
      }
    }
    return sum;
  },
};
