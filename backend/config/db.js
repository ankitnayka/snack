import mongoose from "mongoose";

export const connectDB = async () =>{
    await mongoose.connect('mongodb+srv://ankitnayka:Ankitnayka@cluster0.uiyhvxp.mongodb.net/snack').then(()=>{
       console.log('DB connected') ;
    })
}

