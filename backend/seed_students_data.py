"""
Reference data for ``seed_students.py`` — names, places, phone shapes, photos
and interest vocabulary.

Kept apart from the generator so the two can be read for different reasons: the
generator holds the rules (what a roll number is, which level a 2024 entrant can
be at), this module holds only the raw material those rules draw from. Nothing
here reads the database or the network.

Every name bank pairs first names and surnames with the places its students
actually live, because ``name ↔ nationality ↔ location`` has to hold: a student
called Nandhini Subramanian belongs in Tamil Nadu, not in Guwahati. That is why
these are regional banks rather than one flat list of "Indian names".

The names are ordinary given names and surnames used as a demo population. They
are not drawn from any real student roster.
"""

from __future__ import annotations

from dataclasses import dataclass


# ---------------------------------------------------------------- name banks ---


@dataclass(frozen=True)
class NameBank:
    """
    One naming/locale group: the first names, surnames and places that go
    together.

    ``weight`` is a relative share, not a percentage — the generator normalises
    across whichever banks it is choosing between, so a bank can be added or
    removed without every other number needing to be rebalanced.

    ``places`` are ``(state, city)`` pairs. Both are required by
    ``ProfileCompleteRequest``, and pairing them here is what stops a profile
    claiming Kochi, Punjab.
    """

    key: str
    weight: float
    male: tuple[str, ...]
    female: tuple[str, ...]
    surnames: tuple[str, ...]
    places: tuple[tuple[str, str], ...]


# Indian regions. Weights are a rough nod to where a large online BS cohort
# actually comes from — the Hindi belt and the big southern states dominate —
# rather than an even split across regions, which would read as synthetic.
INDIAN_REGIONS: tuple[NameBank, ...] = (
    NameBank(
        key="hindi_belt",
        weight=22.0,
        male=(
            "Aman", "Ankit", "Abhishek", "Deepak", "Gaurav", "Himanshu", "Mohit",
            "Nitin", "Piyush", "Rahul", "Saurabh", "Shivam", "Sumit", "Vikas",
            "Yash", "Ayush", "Kartik", "Prashant", "Utkarsh", "Devansh",
        ),
        female=(
            "Anjali", "Bhavna", "Divya", "Ekta", "Garima", "Jyoti", "Komal",
            "Manisha", "Neha", "Pooja", "Richa", "Shreya", "Sonal", "Swati",
            "Vandana", "Muskan", "Nikita", "Prachi", "Ritika", "Tanya",
        ),
        surnames=(
            "Sharma", "Verma", "Gupta", "Agarwal", "Mishra", "Tiwari", "Yadav",
            "Pandey", "Srivastava", "Chaturvedi", "Saxena", "Rathore", "Chauhan",
            "Jaiswal", "Dubey", "Tripathi", "Bansal", "Goyal", "Nigam", "Shukla",
        ),
        places=(
            ("Uttar Pradesh", "Lucknow"), ("Uttar Pradesh", "Kanpur"),
            ("Uttar Pradesh", "Varanasi"), ("Uttar Pradesh", "Prayagraj"),
            ("Uttar Pradesh", "Agra"), ("Uttar Pradesh", "Noida"),
            ("Uttar Pradesh", "Ghaziabad"), ("Uttar Pradesh", "Gorakhpur"),
            ("Madhya Pradesh", "Indore"), ("Madhya Pradesh", "Bhopal"),
            ("Madhya Pradesh", "Jabalpur"), ("Madhya Pradesh", "Gwalior"),
            ("Rajasthan", "Jaipur"), ("Rajasthan", "Jodhpur"),
            ("Rajasthan", "Udaipur"), ("Rajasthan", "Kota"),
            ("Bihar", "Patna"), ("Bihar", "Muzaffarpur"), ("Bihar", "Gaya"),
            ("Delhi", "New Delhi"), ("Delhi", "Dwarka"),
            ("Chhattisgarh", "Raipur"), ("Jharkhand", "Ranchi"),
        ),
    ),
    NameBank(
        key="tamil",
        weight=15.0,
        male=(
            "Arjun", "Karthik", "Vignesh", "Dinesh", "Surya", "Hariharan",
            "Ashwin", "Balaji", "Prakash", "Sathish", "Manikandan", "Ganesh",
            "Naveen", "Sundar", "Muthukumar", "Praveen", "Aravind", "Vetri",
            "Kalaimani", "Sivakumar",
        ),
        female=(
            "Divya", "Priya", "Lakshmi", "Kavya", "Meena", "Anitha", "Revathi",
            "Bhuvana", "Nandhini", "Shalini", "Deepa", "Janani", "Kalaivani",
            "Swetha", "Abinaya", "Malini", "Sowmya", "Vaishnavi", "Ilakkiya",
            "Thamizhselvi",
        ),
        surnames=(
            "Subramanian", "Iyer", "Raman", "Krishnan", "Natarajan", "Murugan",
            "Balasubramaniam", "Sundaram", "Venkatesan", "Palaniappan", "Sekar",
            "Rajan", "Chidambaram", "Thangavelu", "Kannan", "Ramachandran",
        ),
        places=(
            ("Tamil Nadu", "Chennai"), ("Tamil Nadu", "Coimbatore"),
            ("Tamil Nadu", "Madurai"), ("Tamil Nadu", "Tiruchirappalli"),
            ("Tamil Nadu", "Salem"), ("Tamil Nadu", "Erode"),
            ("Tamil Nadu", "Tirunelveli"), ("Tamil Nadu", "Vellore"),
            ("Tamil Nadu", "Thanjavur"), ("Tamil Nadu", "Tiruppur"),
            ("Tamil Nadu", "Kanchipuram"), ("Puducherry", "Puducherry"),
        ),
    ),
    NameBank(
        key="telugu",
        weight=13.0,
        male=(
            "Sai", "Venkat", "Chaitanya", "Sandeep", "Praneeth", "Nikhil",
            "Rakesh", "Srikanth", "Vamsi", "Kiran", "Harsha", "Charan",
            "Yashwanth", "Bhargav", "Teja", "Rohith", "Sumanth", "Pavan",
        ),
        female=(
            "Sravani", "Anusha", "Keerthi", "Manasa", "Sindhu", "Harika",
            "Pallavi", "Bhavana", "Ramya", "Sirisha", "Lavanya", "Nikitha",
            "Padmavathi", "Deepika", "Jhansi", "Vijaya", "Sahithi", "Mounika",
        ),
        surnames=(
            "Reddy", "Naidu", "Chowdary", "Rao", "Prasad", "Varma", "Sarma",
            "Goud", "Bandaru", "Kondapalli", "Vemula", "Gollapudi", "Pothineni",
            "Adusumilli", "Yerramsetti",
        ),
        places=(
            ("Telangana", "Hyderabad"), ("Telangana", "Warangal"),
            ("Telangana", "Karimnagar"), ("Telangana", "Nizamabad"),
            ("Andhra Pradesh", "Visakhapatnam"), ("Andhra Pradesh", "Vijayawada"),
            ("Andhra Pradesh", "Guntur"), ("Andhra Pradesh", "Tirupati"),
            ("Andhra Pradesh", "Nellore"), ("Andhra Pradesh", "Rajahmundry"),
            ("Andhra Pradesh", "Kakinada"), ("Andhra Pradesh", "Kurnool"),
        ),
    ),
    NameBank(
        key="marathi",
        weight=11.0,
        male=(
            "Aditya", "Omkar", "Shubham", "Sagar", "Tejas", "Rohit", "Pratik",
            "Swapnil", "Akash", "Mayur", "Sarthak", "Nilesh", "Vaibhav",
            "Siddhesh", "Chinmay", "Atharva", "Prathamesh",
        ),
        female=(
            "Aditi", "Ashwini", "Gauri", "Ketaki", "Madhura", "Mrunal", "Neha",
            "Priyanka", "Rutuja", "Sanika", "Shraddha", "Tanvi", "Snehal",
            "Aboli", "Mrudula", "Purva", "Sayali",
        ),
        surnames=(
            "Deshmukh", "Patil", "Joshi", "Kulkarni", "Jadhav", "Chavan",
            "More", "Shinde", "Pawar", "Gaikwad", "Kadam", "Bhosale", "Sawant",
            "Salunkhe", "Nimbalkar", "Ghatge",
        ),
        places=(
            ("Maharashtra", "Mumbai"), ("Maharashtra", "Pune"),
            ("Maharashtra", "Nagpur"), ("Maharashtra", "Nashik"),
            ("Maharashtra", "Chhatrapati Sambhajinagar"),
            ("Maharashtra", "Solapur"), ("Maharashtra", "Kolhapur"),
            ("Maharashtra", "Thane"), ("Maharashtra", "Amravati"),
            ("Maharashtra", "Sangli"), ("Goa", "Panaji"),
        ),
    ),
    NameBank(
        key="kannada",
        weight=9.0,
        male=(
            "Manjunath", "Shreyas", "Chetan", "Gagan", "Sanjay", "Vikas",
            "Rakshith", "Pradeep", "Darshan", "Sudeep", "Anand", "Yogesh",
            "Nagaraj", "Prajwal", "Vinayak", "Girish",
        ),
        female=(
            "Ashwini", "Bhavya", "Chaitra", "Deeksha", "Kavitha", "Meghana",
            "Nandini", "Pooja", "Rashmi", "Sneha", "Spoorthi", "Trupti",
            "Vidya", "Yamini", "Sahana", "Shwetha",
        ),
        surnames=(
            "Gowda", "Hegde", "Shetty", "Rao", "Kulkarni", "Patil", "Bhat",
            "Kamath", "Nayak", "Murthy", "Iyengar", "Desai", "Prabhu",
            "Acharya", "Kotian",
        ),
        places=(
            ("Karnataka", "Bengaluru"), ("Karnataka", "Mysuru"),
            ("Karnataka", "Mangaluru"), ("Karnataka", "Hubballi"),
            ("Karnataka", "Belagavi"), ("Karnataka", "Davanagere"),
            ("Karnataka", "Shivamogga"), ("Karnataka", "Tumakuru"),
            ("Karnataka", "Ballari"), ("Karnataka", "Udupi"),
        ),
    ),
    NameBank(
        key="bengali",
        weight=8.0,
        male=(
            "Arnab", "Bikram", "Debasish", "Indranil", "Joydeep", "Prithviraj",
            "Rudra", "Sandipan", "Soumya", "Subhankar", "Tanmoy", "Ujjwal",
            "Sourav", "Aniruddha", "Shantanu", "Rajarshi",
        ),
        female=(
            "Ananya", "Debolina", "Ishita", "Moumita", "Nandita", "Paromita",
            "Rituparna", "Sanjukta", "Shreya", "Sohini", "Sudeshna",
            "Tanushree", "Trisha", "Piyali", "Anwesha", "Madhuja",
        ),
        surnames=(
            "Banerjee", "Chatterjee", "Mukherjee", "Ghosh", "Bose", "Das",
            "Dutta", "Sen", "Roy", "Chakraborty", "Bhattacharya", "Sarkar",
            "Majumdar", "Nandy", "Kar",
        ),
        places=(
            ("West Bengal", "Kolkata"), ("West Bengal", "Howrah"),
            ("West Bengal", "Durgapur"), ("West Bengal", "Siliguri"),
            ("West Bengal", "Asansol"), ("West Bengal", "Kharagpur"),
            ("West Bengal", "Barasat"), ("West Bengal", "Bardhaman"),
            ("West Bengal", "Malda"), ("Tripura", "Agartala"),
        ),
    ),
    NameBank(
        key="malayali",
        weight=7.5,
        male=(
            "Anoop", "Vishnu", "Jithin", "Sreejith", "Arun", "Ajay", "Deepak",
            "Hari", "Manu", "Prajith", "Shibin", "Vivek", "Akhil", "Nandakumar",
            "Sarath", "Vinayakan",
        ),
        female=(
            "Aiswarya", "Anjali", "Athira", "Devika", "Gayathri", "Greeshma",
            "Jisha", "Meera", "Neethu", "Parvathy", "Reshma", "Sruthi",
            "Anusree", "Lekshmi", "Nimisha", "Aparna",
        ),
        surnames=(
            "Nair", "Menon", "Pillai", "Varma", "Kurup", "Namboothiri",
            "Thomas", "Joseph", "Mathew", "George", "Panicker", "Warrier",
            "Krishnan", "Chandran", "Unnikrishnan",
        ),
        places=(
            ("Kerala", "Thiruvananthapuram"), ("Kerala", "Kochi"),
            ("Kerala", "Kozhikode"), ("Kerala", "Thrissur"),
            ("Kerala", "Kollam"), ("Kerala", "Alappuzha"),
            ("Kerala", "Palakkad"), ("Kerala", "Kannur"),
            ("Kerala", "Kottayam"), ("Kerala", "Malappuram"),
        ),
    ),
    NameBank(
        key="muslim",
        weight=6.5,
        male=(
            "Mohammed", "Ahmed", "Faizan", "Imran", "Rizwan", "Sohail", "Zaid",
            "Arbaaz", "Danish", "Mustafa", "Salman", "Yusuf", "Owais", "Adnan",
            "Shoaib", "Junaid",
        ),
        female=(
            "Ayesha", "Fatima", "Hina", "Iqra", "Nazia", "Rukhsar", "Saba",
            "Sana", "Zoya", "Afreen", "Farheen", "Mahira", "Noor", "Rabia",
            "Nashra", "Sumaiya",
        ),
        surnames=(
            "Khan", "Ansari", "Sheikh", "Qureshi", "Siddiqui", "Hussain",
            "Rahman", "Shaikh", "Pathan", "Mirza", "Farooqui", "Baig", "Ali",
            "Akhtar", "Usmani",
        ),
        places=(
            ("Telangana", "Hyderabad"), ("Uttar Pradesh", "Lucknow"),
            ("Uttar Pradesh", "Aligarh"), ("Uttar Pradesh", "Moradabad"),
            ("Madhya Pradesh", "Bhopal"), ("Kerala", "Kozhikode"),
            ("Maharashtra", "Mumbai"), ("Maharashtra", "Malegaon"),
            ("West Bengal", "Murshidabad"), ("Bihar", "Darbhanga"),
            ("Jammu and Kashmir", "Srinagar"),
        ),
    ),
    NameBank(
        key="gujarati",
        weight=6.0,
        male=(
            "Harsh", "Jay", "Kunal", "Manan", "Nirav", "Parth", "Rushil",
            "Smit", "Tirth", "Vatsal", "Dhruv", "Hitesh", "Bhavesh", "Chirag",
            "Kaushal", "Meet",
        ),
        female=(
            "Aarti", "Bhumi", "Dhara", "Foram", "Hetal", "Janvi", "Khushi",
            "Nidhi", "Palak", "Riddhi", "Shivani", "Urvi", "Vidhi", "Krupa",
            "Dhruvi", "Mansi",
        ),
        surnames=(
            "Patel", "Shah", "Desai", "Mehta", "Joshi", "Trivedi", "Bhatt",
            "Parikh", "Amin", "Vyas", "Thakkar", "Panchal", "Solanki",
            "Chokshi", "Dave",
        ),
        places=(
            ("Gujarat", "Ahmedabad"), ("Gujarat", "Surat"),
            ("Gujarat", "Vadodara"), ("Gujarat", "Rajkot"),
            ("Gujarat", "Bhavnagar"), ("Gujarat", "Jamnagar"),
            ("Gujarat", "Gandhinagar"), ("Gujarat", "Junagadh"),
            ("Gujarat", "Anand"), ("Gujarat", "Nadiad"),
        ),
    ),
    NameBank(
        key="punjabi",
        weight=5.5,
        male=(
            "Gurpreet", "Harpreet", "Jaskaran", "Manpreet", "Navdeep",
            "Rajveer", "Simranjeet", "Tanvir", "Amritpal", "Karanveer",
            "Sukhdeep", "Arshdeep", "Ranbir", "Yuvraj", "Ekamjot",
        ),
        female=(
            "Amanpreet", "Gurleen", "Harleen", "Jasleen", "Kirandeep",
            "Manveer", "Navneet", "Prabhjot", "Ramneek", "Simran", "Sukhmani",
            "Taranjot", "Ishmeet", "Rupinder", "Amrit",
        ),
        surnames=(
            "Singh", "Kaur", "Gill", "Sidhu", "Dhillon", "Bajwa", "Sandhu",
            "Grewal", "Chahal", "Randhawa", "Sekhon", "Brar", "Mann",
            "Ahluwalia", "Bhullar",
        ),
        places=(
            ("Punjab", "Ludhiana"), ("Punjab", "Amritsar"),
            ("Punjab", "Jalandhar"), ("Punjab", "Patiala"),
            ("Punjab", "Bathinda"), ("Punjab", "Mohali"),
            ("Chandigarh", "Chandigarh"), ("Haryana", "Gurugram"),
            ("Haryana", "Faridabad"), ("Haryana", "Ambala"),
            ("Haryana", "Hisar"),
        ),
    ),
    NameBank(
        key="odia",
        weight=3.5,
        male=(
            "Sibasish", "Bikash", "Prasant", "Suvendu", "Debasis", "Amiya",
            "Nilamadhab", "Tapas", "Sourav", "Jagannath", "Rudra Narayan",
        ),
        female=(
            "Sasmita", "Snigdha", "Bandita", "Itishree", "Lipsa", "Madhusmita",
            "Rashmita", "Jyotshna", "Subhalaxmi", "Pragyan",
        ),
        surnames=(
            "Mohanty", "Patnaik", "Panda", "Behera", "Sahoo", "Nayak",
            "Pradhan", "Jena", "Rout", "Mahapatra",
        ),
        places=(
            ("Odisha", "Bhubaneswar"), ("Odisha", "Cuttack"),
            ("Odisha", "Rourkela"), ("Odisha", "Berhampur"),
            ("Odisha", "Sambalpur"), ("Odisha", "Puri"),
            ("Odisha", "Balasore"),
        ),
    ),
    NameBank(
        key="north_east",
        weight=3.0,
        male=(
            "Anupam", "Bhaskar", "Dhrubajyoti", "Jyotishman", "Pranjal",
            "Rituraj", "Simanta", "Nabajyoti", "Tonmoy", "Wangkhem",
            "Lalrinsanga",
        ),
        female=(
            "Anwesha", "Bornali", "Dipika", "Jonali", "Mridusmita", "Nabanita",
            "Parismita", "Rupjyoti", "Trishna", "Barsha", "Zonunmawii",
        ),
        surnames=(
            "Borah", "Bora", "Deka", "Gogoi", "Hazarika", "Saikia", "Baruah",
            "Nath", "Kalita", "Sangma", "Marak", "Lyngdoh",
        ),
        places=(
            ("Assam", "Guwahati"), ("Assam", "Dibrugarh"),
            ("Assam", "Silchar"), ("Assam", "Jorhat"),
            ("Manipur", "Imphal"), ("Meghalaya", "Shillong"),
            ("Mizoram", "Aizawl"), ("Nagaland", "Kohima"),
            ("Tripura", "Agartala"), ("Arunachal Pradesh", "Itanagar"),
        ),
    ),
    NameBank(
        key="hill_states",
        weight=2.5,
        male=(
            "Vikram", "Sahil", "Ankush", "Abhinav", "Rohit", "Bilal", "Aamir",
            "Tanveer", "Pushkar", "Devesh",
        ),
        female=(
            "Insha", "Mehak", "Aabha", "Neelam", "Ritika", "Shazia", "Anushka",
            "Kritika", "Bhawna", "Pallvi",
        ),
        surnames=(
            "Bhat", "Pandita", "Dar", "Wani", "Rana", "Thakur", "Negi",
            "Rawat", "Chandel", "Bisht",
        ),
        places=(
            ("Jammu and Kashmir", "Srinagar"), ("Jammu and Kashmir", "Jammu"),
            ("Himachal Pradesh", "Shimla"), ("Himachal Pradesh", "Dharamshala"),
            ("Himachal Pradesh", "Mandi"), ("Uttarakhand", "Dehradun"),
            ("Uttarakhand", "Haridwar"), ("Uttarakhand", "Haldwani"),
            ("Ladakh", "Leh"),
        ),
    ),
    NameBank(
        key="konkan_christian",
        weight=2.0,
        male=(
            "Alwyn", "Clifford", "Denzil", "Glenn", "Joel", "Nigel", "Ryan",
            "Savio", "Trevor", "Wilson",
        ),
        female=(
            "Alicia", "Bianca", "Celine", "Fiona", "Glenda", "Jocelyn",
            "Melissa", "Rochelle", "Sharon", "Verona",
        ),
        surnames=(
            "D'Souza", "Fernandes", "Pereira", "Rodrigues", "Gonsalves",
            "Braganza", "Almeida", "Coelho", "Sequeira", "Lobo",
        ),
        places=(
            ("Goa", "Panaji"), ("Goa", "Margao"), ("Goa", "Vasco da Gama"),
            ("Maharashtra", "Mumbai"), ("Karnataka", "Mangaluru"),
            ("Tamil Nadu", "Chennai"), ("Kerala", "Kochi"),
        ),
    ),
)


# ------------------------------------------------------------ phone patterns ---

# A pattern is a national number with `#` standing in for a random digit. The
# country code is prepended with a space, so what lands in `profile.phone` reads
# the way somebody from that country would write it.
#
# Indian numbers are the exception: they are stored as bare 10 digits with no
# country code, because that is what the profile form validates
# (`/^\d{10}$/` in CompleteProfilePage) and what an Indian student types.
INDIA_MOBILE_PATTERNS: tuple[str, ...] = (
    "6#########", "7#########", "8#########", "9#########",
)


@dataclass(frozen=True)
class CountryBank:
    """One international origin: who lives there, where, and how a number reads."""

    country: str
    nationality: str
    weight: float
    region: str  # Americas | Asia-Pacific | South Asia | Europe | Middle East
    names: NameBank
    dial_code: str
    phone_patterns: tuple[str, ...]
    # Share of this country's students who are Indian expatriates — an Indian
    # name and nationality with a local address. Realistic for the Gulf, where
    # much of the IITM BS cohort abroad sits, and left at zero elsewhere.
    indian_expat_share: float = 0.0


INTERNATIONAL_COUNTRIES: tuple[CountryBank, ...] = (
    CountryBank(
        country="United States",
        nationality="American",
        weight=10.0,
        region="Americas",
        names=NameBank(
            key="us",
            weight=1.0,
            male=("Ethan", "Liam", "Noah", "Mason", "Logan", "Caleb", "Owen",
                  "Nathan", "Tyler", "Brandon"),
            female=("Emma", "Olivia", "Ava", "Sophia", "Chloe", "Grace",
                    "Hannah", "Lily", "Zoe", "Madison"),
            surnames=("Anderson", "Bennett", "Carter", "Foster", "Hayes",
                      "Mitchell", "Parker", "Reynolds", "Sullivan", "Turner"),
            places=(("California", "San Jose"), ("New York", "New York"),
                    ("Texas", "Austin"), ("Illinois", "Chicago"),
                    ("Massachusetts", "Boston"), ("Washington", "Seattle"),
                    ("Georgia", "Atlanta"), ("New Jersey", "Edison")),
        ),
        dial_code="+1",
        # 555-01xx is the range reserved for fiction, so no real line is dialled.
        phone_patterns=("415 555-01##", "212 555-01##", "312 555-01##",
                        "617 555-01##", "206 555-01##", "512 555-01##"),
    ),
    CountryBank(
        country="United Arab Emirates",
        nationality="Emirati",
        weight=13.0,
        region="Middle East",
        names=NameBank(
            key="ae",
            weight=1.0,
            male=("Omar", "Khalid", "Yousef", "Hamdan", "Saif", "Rashid",
                  "Abdulla", "Faisal"),
            female=("Maryam", "Fatima", "Noura", "Shaikha", "Aisha", "Latifa",
                    "Hessa", "Salma"),
            surnames=("Al Marzooqi", "Al Suwaidi", "Al Mansoori", "Al Hashmi",
                      "Al Zaabi", "Al Nuaimi", "Al Falasi", "Al Shamsi"),
            places=(("Dubai", "Dubai"), ("Abu Dhabi", "Abu Dhabi"),
                    ("Sharjah", "Sharjah"), ("Ajman", "Ajman"),
                    ("Ras Al Khaimah", "Ras Al Khaimah")),
        ),
        dial_code="+971",
        phone_patterns=("50 ### ####", "52 ### ####", "54 ### ####",
                        "55 ### ####", "56 ### ####"),
        indian_expat_share=0.55,
    ),
    CountryBank(
        country="Singapore",
        nationality="Singaporean",
        weight=9.0,
        region="Asia-Pacific",
        names=NameBank(
            key="sg",
            weight=1.0,
            male=("Wei Jie", "Jun Hao", "Kai Xiang", "Ming Sheng", "Zhi Hao",
                  "Haziq", "Daniel", "Aravind"),
            female=("Xin Yi", "Hui Ling", "Jia Min", "Wan Ting", "Shu Fen",
                    "Nurul", "Rachel", "Priya"),
            surnames=("Tan", "Lim", "Lee", "Ng", "Wong", "Goh", "Chua", "Koh"),
            places=(("Singapore", "Singapore"), ("Singapore", "Jurong East"),
                    ("Singapore", "Tampines"), ("Singapore", "Woodlands"),
                    ("Singapore", "Bedok")),
        ),
        dial_code="+65",
        phone_patterns=("8### ####", "9### ####"),
    ),
    CountryBank(
        country="Australia",
        nationality="Australian",
        weight=8.0,
        region="Asia-Pacific",
        names=NameBank(
            key="au",
            weight=1.0,
            male=("Jack", "Oliver", "Lucas", "Cooper", "Riley", "Hayden",
                  "Declan", "Angus"),
            female=("Charlotte", "Amelia", "Isla", "Ruby", "Willow", "Harper",
                    "Matilda", "Sienna"),
            surnames=("Thompson", "Walker", "Harris", "Campbell", "Kelly",
                      "Ryan", "Nguyen", "O'Brien"),
            places=(("New South Wales", "Sydney"), ("Victoria", "Melbourne"),
                    ("Queensland", "Brisbane"), ("Western Australia", "Perth"),
                    ("South Australia", "Adelaide"),
                    ("Australian Capital Territory", "Canberra")),
        ),
        dial_code="+61",
        phone_patterns=("4## ### ###",),
    ),
    CountryBank(
        country="Bangladesh",
        nationality="Bangladeshi",
        weight=8.0,
        region="South Asia",
        names=NameBank(
            key="bd",
            weight=1.0,
            male=("Tanvir", "Rakib", "Sabbir", "Nafis", "Mahin", "Arif",
                  "Shakib", "Rifat"),
            female=("Nusrat", "Tasnim", "Farzana", "Sumaiya", "Anika",
                    "Mehjabin", "Sadia", "Rumana"),
            surnames=("Rahman", "Hossain", "Islam", "Ahmed", "Chowdhury",
                      "Karim", "Uddin", "Haque"),
            places=(("Dhaka", "Dhaka"), ("Chattogram", "Chattogram"),
                    ("Khulna", "Khulna"), ("Sylhet", "Sylhet"),
                    ("Rajshahi", "Rajshahi")),
        ),
        dial_code="+880",
        phone_patterns=("1#########",),
    ),
    CountryBank(
        country="Sri Lanka",
        nationality="Sri Lankan",
        weight=7.0,
        region="South Asia",
        names=NameBank(
            key="lk",
            weight=1.0,
            male=("Kasun", "Nuwan", "Sanjaya", "Tharindu", "Ravindu", "Ashan",
                  "Dinuka", "Chamath"),
            female=("Nimali", "Sachini", "Dilini", "Hasini", "Ishara",
                    "Tharushi", "Amaya", "Kavindi"),
            surnames=("Perera", "Fernando", "Silva", "Jayawardena", "Bandara",
                      "Wickramasinghe", "Gunasekara", "Dissanayake"),
            places=(("Western Province", "Colombo"),
                    ("Central Province", "Kandy"),
                    ("Southern Province", "Galle"),
                    ("Northern Province", "Jaffna"),
                    ("Western Province", "Negombo")),
        ),
        dial_code="+94",
        phone_patterns=("7#######",),
    ),
    CountryBank(
        country="Germany",
        nationality="German",
        weight=6.0,
        region="Europe",
        names=NameBank(
            key="de",
            weight=1.0,
            male=("Lukas", "Jonas", "Felix", "Maximilian", "Niklas", "Tobias",
                  "Leon", "Julian"),
            female=("Hannah", "Lena", "Marie", "Sophie", "Lea", "Johanna",
                    "Clara", "Emilia"),
            surnames=("Müller", "Schmidt", "Schneider", "Fischer", "Weber",
                      "Meyer", "Wagner", "Becker"),
            places=(("Bavaria", "Munich"), ("Berlin", "Berlin"),
                    ("Baden-Württemberg", "Stuttgart"),
                    ("North Rhine-Westphalia", "Cologne"),
                    ("Hamburg", "Hamburg"), ("Hesse", "Frankfurt")),
        ),
        dial_code="+49",
        phone_patterns=("15# #######", "17# #######"),
    ),
    CountryBank(
        country="The Netherlands",
        nationality="Dutch",
        weight=5.0,
        region="Europe",
        names=NameBank(
            key="nl",
            weight=1.0,
            male=("Daan", "Sem", "Bram", "Thijs", "Jasper", "Ruben", "Sven",
                  "Joris"),
            female=("Julia", "Sanne", "Lotte", "Fleur", "Anouk", "Marit",
                    "Isa", "Femke"),
            surnames=("de Vries", "van Dijk", "Jansen", "Bakker", "Visser",
                      "Smit", "Mulder", "de Boer"),
            places=(("North Holland", "Amsterdam"),
                    ("South Holland", "Rotterdam"), ("South Holland", "Delft"),
                    ("Utrecht", "Utrecht"), ("North Brabant", "Eindhoven"),
                    ("Groningen", "Groningen")),
        ),
        dial_code="+31",
        phone_patterns=("6 ########",),
    ),
    CountryBank(
        country="Oman",
        nationality="Omani",
        weight=6.0,
        region="Middle East",
        names=NameBank(
            key="om",
            weight=1.0,
            male=("Sultan", "Hamed", "Said", "Talib", "Nasser", "Badar"),
            female=("Muna", "Amal", "Asma", "Buthaina", "Rahma", "Zuwaina"),
            surnames=("Al Balushi", "Al Habsi", "Al Kindi", "Al Lawati",
                      "Al Rawahi", "Al Zadjali", "Al Harthy"),
            places=(("Muscat", "Muscat"), ("Dhofar", "Salalah"),
                    ("North Batinah", "Sohar"), ("Dakhiliyah", "Nizwa")),
        ),
        dial_code="+968",
        phone_patterns=("9### ####",),
        indian_expat_share=0.5,
    ),
    CountryBank(
        country="Kuwait",
        nationality="Kuwaiti",
        weight=5.5,
        region="Middle East",
        names=NameBank(
            key="kw",
            weight=1.0,
            male=("Abdulaziz", "Fahad", "Bader", "Mishari", "Yousef", "Talal"),
            female=("Dalal", "Shaikha", "Farah", "Lulwa", "Munira", "Hessa"),
            surnames=("Al Mutairi", "Al Ajmi", "Al Rashidi", "Al Enezi",
                      "Al Otaibi", "Al Hajri"),
            places=(("Al Asimah", "Kuwait City"), ("Hawalli", "Salmiya"),
                    ("Farwaniya", "Farwaniya"), ("Ahmadi", "Fahaheel")),
        ),
        dial_code="+965",
        phone_patterns=("5### ####", "6### ####", "9### ####"),
        indian_expat_share=0.5,
    ),
    CountryBank(
        country="Bahrain",
        nationality="Bahraini",
        weight=4.5,
        region="Middle East",
        names=NameBank(
            key="bh",
            weight=1.0,
            male=("Ali", "Hassan", "Yaqoob", "Salman", "Jassim", "Ebrahim"),
            female=("Noor", "Zainab", "Huda", "Amna", "Dana", "Reem"),
            surnames=("Al Doseri", "Al Mahmood", "Al Sayed", "Buhazza",
                      "Al Alawi", "Janahi"),
            places=(("Capital Governorate", "Manama"),
                    ("Muharraq", "Muharraq"),
                    ("Northern Governorate", "Riffa"),
                    ("Southern Governorate", "Isa Town")),
        ),
        dial_code="+973",
        phone_patterns=("3### ####",),
        indian_expat_share=0.5,
    ),
    CountryBank(
        country="Japan",
        nationality="Japanese",
        weight=5.0,
        region="Asia-Pacific",
        names=NameBank(
            key="jp",
            weight=1.0,
            male=("Haruto", "Yuto", "Sota", "Ren", "Kaito", "Riku", "Takumi",
                  "Hiroshi"),
            female=("Sakura", "Yui", "Hina", "Aoi", "Rin", "Mio", "Nanami",
                    "Akari"),
            surnames=("Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe",
                      "Ito", "Yamamoto", "Nakamura"),
            places=(("Tokyo", "Tokyo"), ("Osaka", "Osaka"),
                    ("Kanagawa", "Yokohama"), ("Aichi", "Nagoya"),
                    ("Fukuoka", "Fukuoka"), ("Hokkaido", "Sapporo")),
        ),
        dial_code="+81",
        phone_patterns=("90-####-####", "80-####-####"),
    ),
    CountryBank(
        country="China",
        nationality="Chinese",
        weight=4.5,
        region="Asia-Pacific",
        names=NameBank(
            key="cn",
            weight=1.0,
            male=("Wei", "Hao", "Jun", "Yifan", "Zihao", "Lei", "Bo", "Chao"),
            female=("Xiaoyu", "Yuting", "Mengqi", "Jiaqi", "Lingling", "Siyu",
                    "Ruoxi", "Nan"),
            surnames=("Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang",
                      "Zhao"),
            places=(("Beijing", "Beijing"), ("Shanghai", "Shanghai"),
                    ("Guangdong", "Shenzhen"), ("Zhejiang", "Hangzhou"),
                    ("Sichuan", "Chengdu"), ("Jiangsu", "Nanjing")),
        ),
        dial_code="+86",
        phone_patterns=("13# #### ####", "15# #### ####", "18# #### ####"),
    ),
)


# ------------------------------------------------------------------- streets ---

# Address lines. Deliberately generic: the flat/house number is randomised and
# the road name comes from this list, so no generated address resolves to a real
# residence.
INDIAN_STREETS: tuple[str, ...] = (
    "Gandhi Road", "Nehru Street", "MG Road", "Station Road", "Temple Street",
    "Lake View Road", "Anna Nagar Main Road", "Church Street", "Park Avenue",
    "Bazaar Street", "Kamaraj Salai", "Subhash Marg", "Ring Road",
    "College Road", "Housing Board Colony", "Sector 12", "Vivekananda Layout",
    "Rajaji Street", "Bharathi Nagar", "Green Park Extension",
)

INTERNATIONAL_STREETS: tuple[str, ...] = (
    "Maple Avenue", "Orchard Lane", "Harbour View", "Cedar Street",
    "King Street", "Marina Walk", "Station Strasse", "Central Boulevard",
    "Riverside Terrace", "Palm Crescent", "Hillside Road", "Garden Court",
)


# ------------------------------------------------------------------- photos ---

# Two public sources, chosen so no photo has to be reused:
#
# * randomuser.me publishes 100 men's and 100 women's portraits explicitly for
#   demo data. Each one is handed out at most once, and matched to the student's
#   gender.
# * DiceBear renders a distinct illustrated avatar per `seed`, so the rest of
#   the cohort gets a unique image keyed on its roll number.
#
# Neither source depicts an IIT Madras student, and nothing here should be read
# as suggesting otherwise — they are placeholders for a demo dataset.
RANDOMUSER_PORTRAITS_PER_GENDER = 100
RANDOMUSER_URL = "https://randomuser.me/api/portraits/{group}/{index}.jpg"

DICEBEAR_URL = "https://api.dicebear.com/9.x/{style}/svg?seed={seed}"
DICEBEAR_STYLES: tuple[str, ...] = (
    "adventurer", "avataaars", "big-smile", "lorelei", "micah", "notionists",
    "open-peeps", "personas",
)


# --------------------------------------------------------------- interests ---

# Free-text `event_preferences`, which the backend embeds for recommendations.
# Grouped by theme so a student's stated interests can lean towards their degree
# without every student in a degree saying the same thing.
INTEREST_PHRASES: dict[str, tuple[str, ...]] = {
    "data": (
        "machine learning talks and anything with a leaderboard",
        "data visualisation, dashboards and storytelling with numbers",
        "LLM and generative AI sessions",
        "statistics puzzles, probability games and quizzes",
        "hackathons where I can ship a model end to end",
        "analytics case studies and Kaggle-style contests",
    ),
    "electronics": (
        "embedded systems, microcontrollers and anything I can solder",
        "robotics builds and line-follower contests",
        "circuit debugging challenges and hardware demos",
        "IoT projects, sensors and signal processing",
        "FPGA and chip design sessions",
        "drone and RC hardware tinkering",
    ),
    "management": (
        "case competitions, consulting and business strategy",
        "startup pitches, product thinking and demo days",
        "finance, markets and stock simulation games",
        "marketing, branding and campaign contests",
        "operations puzzles and supply chain case studies",
        "entrepreneurship panels and founder talks",
    ),
    "aerospace": (
        "aerodynamics, rocketry and anything that flies",
        "space missions, satellites and orbital mechanics talks",
        "drone racing and UAV design challenges",
        "aircraft design reviews and wind tunnel demos",
        "propulsion and simulation sessions",
    ),
    "culture": (
        "music nights, open mics and battle of bands",
        "dance competitions and choreography workshops",
        "stand-up comedy and improv",
        "photography walks and design contests",
        "quizzing, debates and literary events",
        "anime, cosplay and gaming meetups",
        "theatre, skits and storytelling",
    ),
    "sports": (
        "football and anything inter-house",
        "cricket, both playing and following the auction",
        "badminton and table tennis",
        "running, athletics and fitness sessions",
        "chess and strategy board games",
        "esports — BGMI and Valorant",
        "treasure hunts and escape rooms",
    ),
    "general": (
        "meeting people from other houses",
        "career sessions and alumni talks",
        "whatever is happening near the OAT",
        "anything hands-on rather than lectures",
        "workshops that end with something I built",
        "food stalls and the evening line-up",
    ),
}

# Which interest themes each degree leans towards, and how strongly. The
# `general`, `culture` and `sports` weights are what stop a degree from becoming
# a stereotype: every student draws at least one phrase from the shared pool.
DEGREE_INTEREST_WEIGHTS: dict[str, dict[str, float]] = {
    "DS": {"data": 4.0, "electronics": 0.8, "management": 1.0, "aerospace": 0.4,
           "culture": 2.0, "sports": 1.8, "general": 1.5},
    "ES": {"data": 1.2, "electronics": 4.0, "management": 0.7, "aerospace": 1.0,
           "culture": 1.8, "sports": 1.8, "general": 1.5},
    "MS": {"data": 1.5, "electronics": 0.4, "management": 4.0, "aerospace": 0.3,
           "culture": 2.2, "sports": 1.6, "general": 1.5},
    "AE": {"data": 1.0, "electronics": 1.4, "management": 0.6, "aerospace": 4.0,
           "culture": 1.8, "sports": 1.8, "general": 1.5},
}

# Keywords used to score how much an event or workshop appeals to each degree.
# Matched case-insensitively against the name and description, so the affinity
# comes off the real catalogue rather than a hand-maintained mapping of ids that
# would rot the moment an event is renamed.
AFFINITY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "data": (
        "data", "machine learning", "ml ", "ai", "llm", "analytics", "model",
        "statistic", "probab", "neural", "python", "dashboard", "visual",
        "nlp", "embedding", "quantum", "algorithm", "coding", "code",
        "dataset", "prediction", "retrieval", "agent",
    ),
    "electronics": (
        "electronic", "circuit", "embedded", "fpga", "hardware", "robot",
        "sensor", "iot", "signal", "semiconductor", "chip", "device",
        "cyber-physical", "testability", "digital design", "wireless",
        "electric vehicle", "gadget",
    ),
    "management": (
        "management", "business", "strategy", "startup", "entrepreneur",
        "pitch", "market", "finance", "econom", "pricing", "auction",
        "consult", "product", "operations", "optimis", "optimiz", "decision",
        "revenue", "career", "incubation", "mvp",
    ),
    "aerospace": (
        "aero", "space", "flight", "rocket", "propulsion", "drone", "satellite",
        "orbit", "aviation", "mobility", "digital twin", "simulation",
        "navigation",
    ),
}

# Team names for the handful of team events that get one. Adjective + noun so
# collisions are unlikely without needing a uniqueness check.
TEAM_ADJECTIVES: tuple[str, ...] = (
    "Rogue", "Quantum", "Midnight", "Crimson", "Silent", "Turbo", "Neon",
    "Iron", "Cosmic", "Rapid", "Stellar", "Wild", "Golden", "Electric",
    "Phantom", "Nimble",
)
TEAM_NOUNS: tuple[str, ...] = (
    "Coders", "Falcons", "Circuits", "Titans", "Pandas", "Rockets", "Wolves",
    "Bytes", "Nomads", "Sparks", "Legends", "Owls", "Comets", "Mavericks",
    "Tigers", "Foxes",
)

# `EmergencyContact.relation` — the four values models.py documents.
EMERGENCY_RELATIONS: tuple[tuple[str, float], ...] = (
    ("father", 0.44),
    ("mother", 0.36),
    ("elder_sibling", 0.13),
    ("guardian", 0.07),
)
