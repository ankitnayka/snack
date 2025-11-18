import React from 'react'
import './Footer.css'
import { assets } from '../../assets/assets'

const Footer = () => {
  return (
    <div className='footer' id='footer'>
        <div className="footer-content">
            <div className="footer-content-left">
                {/* <img src={assets.logo} alt="" /> */}
    
  <p
    style={{
      backgroundColor: "orange",
      color: "white",
      padding: "8px",
      borderRadius: "6px"
    }}
  >
    snack shacks
  </p>


                <p>There are many "snack shack" style businesses near Surat, including Kailash Sweets & Snacks which is a well-known and long-established name in the region, and Surendranagar Snacks in Varachha, known for its street food. Other popular options include 24 Carats Mithai Magic, Jay Jalaram Snacks & Fastfood, Hastee Mart, and numerous stalls and small businesses listed on sites like Justdial. </p>
                <div className="footer-social-icons">
                    <img src={assets.facebook_icon} alt="" />
                    <img src={assets.twitter_icon} alt="" />
                    <img src={assets.linkedin_icon} alt="" />
                </div>
            </div>
            <div className="footer-content-center">
                <h2>COMPANY</h2>
                <ul>
                    <li>Home</li>
                    <li>About us</li>
                    <li>Delivery</li>
                    <li>Privacy Policy</li>
                </ul>
            </div>
            <div className="footer-content-right">
                <h2>GET IN TOUCH</h2>
                <ul>
                    <li>+94 765489545</li>
                    <li>snackshacks@gmail.com</li>
                </ul>
            </div>
           
        </div>
        <hr />
        <p className="footer-copyright">
            Copyright 2024 &copy; snack shacks - All Right Reserved.
        </p>
    </div>
  )
}

export default Footer