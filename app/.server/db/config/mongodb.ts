import mongoose, { Mongoose } from "mongoose";

const connectToMongoDB = (): Promise<Mongoose> => {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is not defined.");
  }

  return mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
    .then(() => { console.log("Successfully connected to MongoDB"); })
    .catch((error) => { console.error("Error connecting to MongoDB:", error); });
};

export default connectToMongoDB;